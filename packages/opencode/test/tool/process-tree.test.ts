import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { spawn } from "node:child_process"
import { killProcessTree } from "../../src/tool/shell/process-tree"

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
})
