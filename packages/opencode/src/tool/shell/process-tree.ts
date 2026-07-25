import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect } from "effect"
import { errorMessage } from "@/util/error"

/** Soft escalate from SIGTERM to SIGKILL on POSIX. */
const SIGKILL_TIMEOUT_MS = 200

/**
 * Hard cap for the whole killProcessTree attempt.
 * Windows taskkill can hang indefinitely without this (zombie shell.exit spans).
 */
export const KILL_TREE_TIMEOUT_MS = 5_000

/**
 * Hard cap for the entire killShellProcess sequence (spawner kill + tree fallback).
 * handle.kill can hang on Deferred.await(exit) even after forceKillAfter escalates;
 * this deadline guarantees the shell tool returns and frees the event loop.
 */
export const KILL_SHELL_DEADLINE_MS = 8_000

export type KillTreeResult = {
  readonly ok: boolean
  readonly method: "taskkill" | "posix-group" | "single"
  readonly error?: string
}

/**
 * Race a promise against a deadline. On timeout, invoke `onTimeout`.
 * Exported for unit tests.
 */
export function withDeadline<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const done = (value: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => done(onTimeout()), timeoutMs)
    promise.then(done, () => done(onTimeout()))
  })
}

/**
 * Best-effort process-tree kill used when ChildProcessSpawner.kill fails or hangs.
 * Windows: taskkill /T /F with hard timeout. POSIX: kill process group, then single process fallback.
 * Always settles within ~KILL_TREE_TIMEOUT_MS so shell tools cannot stick on shell.exit forever.
 */
export function killProcessTree(pid: number, opts?: { timeoutMs?: number }): Effect.Effect<KillTreeResult> {
  const timeoutMs = opts?.timeoutMs ?? KILL_TREE_TIMEOUT_MS

  if (!Number.isFinite(pid) || pid <= 0) {
    return Effect.succeed({ ok: false, method: "single", error: "invalid pid" })
  }

  if (process.platform === "win32") {
    return Effect.tryPromise({
      try: () =>
        withDeadline(
          new Promise<KillTreeResult>((resolve) => {
            const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
              stdio: "ignore",
              windowsHide: true,
            })
            let settled = false
            const done = (ok: boolean, error?: string) => {
              if (settled) return
              settled = true
              resolve(ok ? { ok: true, method: "taskkill" } : { ok: false, method: "taskkill", error })
            }
            killer.once("exit", (code) => {
              // 0 = killed, 128 = not found (already gone) — both acceptable.
              if (code === 0 || code === 128) return done(true)
              done(false, `taskkill exit ${code}`)
            })
            killer.once("error", (error) => done(false, errorMessage(error)))
          }),
          timeoutMs,
          () => ({ ok: false, method: "taskkill" as const, error: `taskkill timed out after ${timeoutMs}ms` }),
        ),
      catch: (error) => error,
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          ok: false,
          method: "taskkill" as const,
          error: errorMessage(error),
        }),
      ),
    )
  }

  return Effect.tryPromise({
    try: () =>
      withDeadline(
        (async (): Promise<KillTreeResult> => {
          try {
            process.kill(-pid, "SIGTERM")
            await sleep(SIGKILL_TIMEOUT_MS)
            try {
              process.kill(-pid, 0)
              process.kill(-pid, "SIGKILL")
            } catch {
              // already gone
            }
            return { ok: true, method: "posix-group" }
          } catch {
            try {
              process.kill(pid, "SIGTERM")
              await sleep(SIGKILL_TIMEOUT_MS)
              try {
                process.kill(pid, 0)
                process.kill(pid, "SIGKILL")
              } catch {
                // already gone
              }
              return { ok: true, method: "single" }
            } catch (error) {
              return { ok: false, method: "single", error: errorMessage(error) }
            }
          }
        })(),
        timeoutMs,
        () => ({ ok: false, method: "single" as const, error: `posix kill timed out after ${timeoutMs}ms` }),
      ),
    catch: (error) => error,
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        ok: false,
        method: "single" as const,
        error: errorMessage(error),
      }),
    ),
  )
}
