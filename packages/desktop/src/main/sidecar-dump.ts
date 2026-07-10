import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { SidecarProbeSnapshot } from "./sidecar-perf-probe"

const DEFAULT_MIN_INTERVAL_MS = 30_000
const DEFAULT_REPORT_THRESHOLD_MS = 10_000

type SidecarDumpOptions = {
  readonly stateHome: string
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
  private readonly dumpDir: string
  private readonly minIntervalMs: number
  private readonly reportLagThresholdMs: number
  private readonly log: (message: string) => void

  constructor(options: SidecarDumpOptions) {
    this.dumpDir = join(options.stateHome, "sidecar-dumps")
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
    this.reportLagThresholdMs = options.reportLagThresholdMs ?? DEFAULT_REPORT_THRESHOLD_MS
    this.log = options.log
  }

  captureLag(input: SidecarLagDumpInput): void {
    const now = Date.now()
    if (now - this.lastDumpAt < this.minIntervalMs) return
    this.lastDumpAt = now

    try {
      mkdirSync(this.dumpDir, { recursive: true })
      appendFileSync(this.dumpPath(input, now), `${JSON.stringify(this.dump(input), null, 2)}\n`)
    } catch (error) {
      this.log(`SIDECAR DUMP failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
      return
    }

    this.log(`SIDECAR DUMP written lag=${input.lag}ms dir=${this.dumpDir}`)
  }

  private dump(input: SidecarLagDumpInput): SidecarLagDump {
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
      report: input.lag >= this.reportLagThresholdMs ? process.report?.getReport() : undefined,
    }
  }

  private dumpPath(input: SidecarLagDumpInput, timestamp: number): string {
    return join(this.dumpDir, `sidecar-dump-${new Date(timestamp).toISOString().replace(/[:.]/g, "")}-lag-${input.lag}.json`)
  }
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
