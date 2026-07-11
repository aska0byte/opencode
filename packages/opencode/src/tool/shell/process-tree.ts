import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect } from "effect"
import { errorMessage } from "@/util/error"

const SIGKILL_TIMEOUT_MS = 200

export type KillTreeResult = {
  readonly ok: boolean
  readonly method: "taskkill" | "posix-group" | "single"
  readonly error?: string
}

/**
 * Best-effort process-tree kill used when ChildProcessSpawner.kill fails or hangs.
 * Windows: taskkill /T /F. POSIX: kill process group, then single process fallback.
 */
export function killProcessTree(pid: number): Effect.Effect<KillTreeResult> {
  if (!Number.isFinite(pid) || pid <= 0) {
    return Effect.succeed({ ok: false, method: "single", error: "invalid pid" })
  }

  if (process.platform === "win32") {
    return Effect.tryPromise({
      try: () =>
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
    try: async (): Promise<KillTreeResult> => {
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
    },
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
