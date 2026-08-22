import { execFile } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export type SidecarFreezeReport = {
  detectedAt: string
  url: string
  consecutiveFailures: number
  forensics?: string
}

type FreezeWatchdogOptions = {
  url: string
  username: string
  password: string
  diagnosticsDir: string
  gracePeriodMs?: number
  pollIntervalMs?: number
  failureThreshold?: number
  log: {
    info: (message: string, meta?: unknown) => void
    warn: (message: string, meta?: unknown) => void
    error: (message: string, meta?: unknown) => void
  }
  onFrozen: (report: SidecarFreezeReport) => void | Promise<void>
}

export type SidecarFreezeWatchdog = { stop: () => void }

const DEFAULT_GRACE_MS = 60_000
const DEFAULT_POLL_MS = 10_000
const DEFAULT_THRESHOLD = 4

/**
 * Detects a hard-frozen sidecar from OUTSIDE its process.
 *
 * The in-process LAG probe cannot observe a hard freeze (it needs the event loop
 * to recover before it can log), so this watchdog polls the health endpoint from
 * the Electron main process. After N consecutive failures past the grace period
 * it captures process forensics (CPU-time delta distinguishes a spin-loop from a
 * deadlocked loop) and hands the report to `onFrozen`.
 */
export function startSidecarFreezeWatchdog(options: FreezeWatchdogOptions): SidecarFreezeWatchdog {
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS
  const failureThreshold = options.failureThreshold ?? DEFAULT_THRESHOLD

  const startedAt = Date.now()
  let failures = 0
  let triggered = false
  let stopped = false
  let checking = false

  const timer = setInterval(() => {
    if (stopped || triggered || checking) return
    if (Date.now() - startedAt < gracePeriodMs) return
    checking = true
    void checkOnce().finally(() => {
      checking = false
    })
  }, pollIntervalMs)
  // Do not hold the app open on quit; stopSidecars() stops us explicitly too.
  timer.unref?.()

  async function checkOnce() {
    const healthy = await checkSidecarHealth(options.url, options.username, options.password)
    if (stopped || triggered) return
    if (healthy) {
      if (failures > 0) options.log.info("sidecar freeze watchdog recovered", { failures })
      failures = 0
      return
    }
    failures += 1
    options.log.warn("sidecar freeze watchdog failure", { failures, threshold: failureThreshold })
    if (failures < failureThreshold) return
    triggered = true
    const report = await buildFreezeReport()
    await options.onFrozen(report)
  }

  async function buildFreezeReport(): Promise<SidecarFreezeReport> {
    const report: SidecarFreezeReport = {
      detectedAt: new Date().toISOString(),
      url: options.url,
      consecutiveFailures: failures,
    }
    try {
      if (process.platform === "win32") {
        report.forensics = await captureWindowsForensics(report.detectedAt)
        options.log.info("sidecar freeze forensics captured", { path: report.forensics })
      }
    } catch (error) {
      options.log.error("sidecar freeze forensics failed", error)
    }
    return report
  }

  async function checkSidecarHealth(url: string, username: string, password: string): Promise<boolean> {
    for (const path of ["/global/health", "/api/health"]) {
      try {
        const target = new URL(path, url)
        const headers = new Headers()
        const auth = Buffer.from(`${username}:${password}`).toString("base64")
        headers.set("authorization", `Basic ${auth}`)
        const res = await fetch(target, { method: "GET", headers, signal: AbortSignal.timeout(3000) })
        if (res.ok) return true
      } catch {}
    }
    return false
  }

  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
  }

  async function captureWindowsForensics(detectedAt: string): Promise<string> {
    const port = new URL(options.url).port || "80"
    const script = [
      "$ErrorActionPreference='SilentlyContinue'",
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen`,
      "$pids = $c | Select-Object -ExpandProperty OwningProcess -Unique",
      "function Sample { $pids | ForEach-Object { $p = Get-Process -Id $_; if ($p) { ('{0}|{1}|{2}|{3}|{4}' -f $p.Id,$p.CPU,$p.Threads.Count,[math]::Round($p.WorkingSet64/1MB),$p.StartTime.ToString('o')) } } }",
      "'== sample1 =='; Sample; Start-Sleep -Seconds 3; '-- sample2 --'; Sample",
    ].join("; ")
    const output = await new Promise<string>((resolve, reject) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 20_000 }, (error, stdout) => {
        if (error && !stdout) reject(error)
        else resolve(String(stdout))
      })
    })
    const dir = join(options.diagnosticsDir)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `sidecar-freeze-${detectedAt.replace(/[:.]/g, "-")}.log`)
    appendFileSync(
      file,
      [
        `freeze detected at ${detectedAt}`,
        `url ${options.url}`,
        `consecutive health failures ${failures}`,
        "",
        output.trimEnd(),
        "",
      ].join("\n"),
    )
    return file
  }
}
