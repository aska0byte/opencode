import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { SidecarProbeSnapshot } from "./sidecar-perf-probe"

const DEFAULT_MIN_INTERVAL_MS = 30_000
const DEFAULT_REPORT_THRESHOLD_MS = 10_000

type SidecarDumpOptions = {
  /** Absolute directory for dump files (e.g. APP_DATA/state/diagnostics/sidecar-dumps). */
  readonly dumpDir: string
  readonly log: (message: string) => void
  readonly minIntervalMs?: number
  readonly reportLagThresholdMs?: number
}

export type SidecarLagDumpInput = {
  readonly lag: number
  readonly listenerActive: boolean
  readonly probe?: SidecarProbeSnapshot | undefined
}

type SidecarLagDump = {
  readonly createdAt: string
  readonly lag: number
  readonly listenerActive: boolean
  readonly pid: number
  readonly ppid: number
  readonly uptime: number
  readonly argv: readonly string[]
  readonly execPath: string
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly versions: NodeJS.ProcessVersions
  readonly memoryUsage: NodeJS.MemoryUsage
  readonly cpuUsage: NodeJS.CpuUsage
  readonly resourceUsage: NodeJS.ResourceUsage | { readonly error: string }
  readonly activeResources: readonly string[]
  readonly probe?: SidecarProbeSnapshot | undefined
  readonly report?: unknown
}

export class SidecarDump {
  private lastDumpAt = 0
  /** Single-flight: skip new dumps while a previous write is still in progress. */
  private writing = false
  private readonly dumpDir: string
  private readonly minIntervalMs: number
  private readonly reportLagThresholdMs: number
  private readonly log: (message: string) => void

  constructor(options: SidecarDumpOptions) {
    this.dumpDir = options.dumpDir
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
    this.reportLagThresholdMs = options.reportLagThresholdMs ?? DEFAULT_REPORT_THRESHOLD_MS
    this.log = options.log
  }

  /**
   * Capture a light sync snapshot on the event-loop lag path, then write the dump
   * asynchronously so mkdir/JSON.stringify/writeFile/process.report do not extend
   * the same lag window. Rate-limited and single-flight.
   */
  captureLag(input: SidecarLagDumpInput): void {
    const now = Date.now()
    if (now - this.lastDumpAt < this.minIntervalMs) return
    if (this.writing) return
    this.lastDumpAt = now
    this.writing = true

    let payload: SidecarLagDump
    try {
      // Light snapshot only: memory/cpu/resources/probe. Heavy report is deferred.
      payload = this.snapshot(input)
    } catch (error) {
      this.writing = false
      this.log(`SIDECAR DUMP failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      return
    }

    const path = this.dumpPath(input, now)
    void this.writeAsync(path, payload, input.lag)
  }

  private async writeAsync(path: string, payload: SidecarLagDump, lag: number): Promise<void> {
    try {
      // Yield so the lag monitor / request handlers can run before stringify/IO.
      await yieldEventLoop()

      let body = payload
      if (lag >= this.reportLagThresholdMs && typeof process.report?.getReport === "function") {
        try {
          body = { ...payload, report: process.report.getReport() }
        } catch {
          // Keep dump without report if getReport fails; still write the light snapshot.
        }
      }

      await mkdir(this.dumpDir, { recursive: true })
      await writeFile(path, `${JSON.stringify(body, null, 2)}\n`)
      this.log(`SIDECAR DUMP written lag=${lag}ms dir=${this.dumpDir}`)
    } catch (error) {
      this.log(`SIDECAR DUMP failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    } finally {
      this.writing = false
    }
  }

  private snapshot(input: SidecarLagDumpInput): SidecarLagDump {
    return {
      createdAt: new Date().toISOString(),
      lag: input.lag,
      listenerActive: input.listenerActive,
      pid: process.pid,
      ppid: process.ppid,
      uptime: process.uptime(),
      argv: process.argv,
      execPath: process.execPath,
      cwd: process.cwd(),
      platform: process.platform,
      versions: process.versions,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      resourceUsage: resourceUsage(),
      activeResources: activeResources(),
      probe: input.probe,
    }
  }

  private dumpPath(input: SidecarLagDumpInput, timestamp: number): string {
    return join(this.dumpDir, `sidecar-dump-${new Date(timestamp).toISOString().replace(/[:.]/g, "")}-lag-${input.lag}.json`)
  }
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function resourceUsage(): NodeJS.ResourceUsage | { readonly error: string } {
  try {
    return process.resourceUsage()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function activeResources(): readonly string[] {
  return typeof process.getActiveResourcesInfo === "function" ? process.getActiveResourcesInfo() : []
}
