import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { spawn } from "node:child_process"
import {
  killProcessTree,
  withDeadline,
  KILL_TREE_TIMEOUT_MS,
  KILL_SHELL_DEADLINE_MS,
} from "../../src/tool/shell/process-tree"

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitGone(pid: number, timeoutMs = 5_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (!alive(pid)) return true
    await Bun.sleep(50)
  }
  return !alive(pid)
}

describe("withDeadline", () => {
  test("returns promise value when it settles first", async () => {
    const result = await withDeadline(Promise.resolve("ok"), 1_000, () => "timeout")
    expect(result).toBe("ok")
  })

  test("returns onTimeout when promise never settles", async () => {
    const started = Date.now()
    const result = await withDeadline(
      new Promise<string>(() => {}),
      80,
      () => "timeout",
    )
    const elapsed = Date.now() - started
    expect(result).toBe("timeout")
    expect(elapsed).toBeLessThan(500)
  })
})

describe("killProcessTree", () => {
  test("terminates a long-running child process", async () => {
    // given
    const child =
      process.platform === "win32"
        ? spawn("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 60"], {
            windowsHide: true,
            stdio: "ignore",
          })
        : spawn("sleep", ["60"], { stdio: "ignore", detached: true })

    const pid = child.pid
    expect(pid).toBeDefined()
    if (!pid) throw new Error("missing pid")

    // when
    const result = await Effect.runPromise(killProcessTree(pid))
    const gone = await waitGone(pid)

    // then
    expect(result.ok).toBe(true)
    expect(gone).toBe(true)
  }, 15_000)

  test("is safe for already-exited pid", async () => {
    // given
    const child =
      process.platform === "win32"
        ? spawn("powershell.exe", ["-NoProfile", "-Command", "exit 0"], {
            windowsHide: true,
            stdio: "ignore",
          })
        : spawn("true", [], { stdio: "ignore" })

    const pid = child.pid
    expect(pid).toBeDefined()
    if (!pid) throw new Error("missing pid")
    await new Promise<void>((resolve) => child.once("exit", () => resolve()))

    // when
    const result = await Effect.runPromise(killProcessTree(pid))

    // then — best-effort: either ok (not found) or false with error; must not throw
    expect(typeof result.ok).toBe("boolean")
    expect(result.method === "taskkill" || result.method === "posix-group" || result.method === "single").toBe(true)
  }, 15_000)

  test("invalid pid settles immediately without hang", async () => {
    const started = Date.now()
    const result = await Effect.runPromise(killProcessTree(-1))
    expect(result.ok).toBe(false)
    expect(result.error).toContain("invalid")
    expect(Date.now() - started).toBeLessThan(200)
  })

  test("short timeout still settles (does not hang past deadline)", async () => {
    const timeoutMs = 100
    const started = Date.now()
    const result = await Effect.runPromise(killProcessTree(999_999_991, { timeoutMs }))
    const elapsed = Date.now() - started
    expect(typeof result.ok).toBe("boolean")
    // Must not hang near the global default (5s); allow some OS scheduling slack.
    expect(elapsed).toBeLessThan(KILL_TREE_TIMEOUT_MS)
    expect(elapsed).toBeLessThan(2_000)
  }, 10_000)
})

describe("KILL_SHELL_DEADLINE_MS", () => {
  test("is longer than tree timeout so tree kill can finish inside shell deadline", () => {
    expect(KILL_SHELL_DEADLINE_MS).toBeGreaterThan(KILL_TREE_TIMEOUT_MS)
    expect(KILL_SHELL_DEADLINE_MS).toBeLessThanOrEqual(15_000)
  })
})
