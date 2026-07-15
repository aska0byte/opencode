const DEFAULT_MAX_EVENTS = 80
const DEFAULT_STICKY_EVENTS = 40
const DEFAULT_SLOW_THRESHOLD_MS = 2_000

export type SidecarProbeDetailValue = string | number | boolean | null
export type SidecarProbeDetails = Readonly<Record<string, SidecarProbeDetailValue>>

export type SidecarProbeOptions = {
  readonly log: (message: string) => void
  readonly maxEvents?: number
  readonly stickyEvents?: number
  readonly slowThresholdMs?: number
}

export type SidecarProbeEvent = {
  readonly at: string
  readonly name: string
  readonly phase: "mark" | "start" | "end" | "error"
  readonly durationMs?: number
  readonly details?: SidecarProbeDetails | undefined
}

export type SidecarProbeSnapshot = {
  readonly createdAt: string
  readonly slowThresholdMs: number
  readonly recentEvents: readonly SidecarProbeEvent[]
  readonly stickyEvents: readonly SidecarProbeEvent[]
  readonly activeSpans: readonly SidecarProbeEvent[]
}

export type SidecarProbeSpan = {
  readonly end: () => void
  readonly error: (message: string) => void
  readonly setDetails: (details: SidecarProbeDetails) => void
}

type ActiveSpan = {
  readonly startedAt: number
  event: SidecarProbeEvent
}

export class SidecarPerfProbe {
  private nextSpanID = 0
  private readonly activeSpans = new Map<number, ActiveSpan>()
  private readonly recentEvents: SidecarProbeEvent[] = []
  private readonly stickyEvents: SidecarProbeEvent[] = []
  private readonly log: (message: string) => void
  private readonly maxEvents: number
  private readonly stickyMax: number
  private readonly slowThresholdMs: number

  constructor(options: SidecarProbeOptions) {
    this.log = options.log
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
    this.stickyMax = options.stickyEvents ?? DEFAULT_STICKY_EVENTS
    this.slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS
  }

  mark(name: string, details?: SidecarProbeDetails): void {
    this.record({ at: new Date().toISOString(), name, phase: "mark", details })
  }

  /** Patch active span details by callID (used while Tool.execute is in-flight). */
  patchActiveByCallID(callID: string, patch: SidecarProbeDetails): void {
    for (const [spanID, span] of this.activeSpans) {
      if (span.event.details?.callID !== callID) continue
      span.event = {
        ...span.event,
        details: { ...span.event.details, ...patch },
      }
      this.activeSpans.set(spanID, span)
    }
  }

  async measure<T>(name: string, details: SidecarProbeDetails, run: () => Promise<T>): Promise<T> {
    const spanID = this.start(name, details)
    try {
      const result = await run()
      this.end(spanID)
      return result
    } catch (error) {
      this.fail(spanID, error)
      throw error
    }
  }

  begin(name: string, details?: SidecarProbeDetails): SidecarProbeSpan {
    const spanID = this.start(name, details)
    return {
      end: () => this.end(spanID),
      error: (message) => this.fail(spanID, message),
      setDetails: (patch) => this.patchSpan(spanID, patch),
    }
  }

  snapshot(): SidecarProbeSnapshot {
    const now = Date.now()
    return {
      createdAt: new Date().toISOString(),
      slowThresholdMs: this.slowThresholdMs,
      recentEvents: [...this.recentEvents],
      stickyEvents: [...this.stickyEvents],
      activeSpans: [...this.activeSpans.values()].map((span) => ({
        ...span.event,
        durationMs: now - span.startedAt,
      })),
    }
  }

  private start(name: string, details?: SidecarProbeDetails): number {
    const spanID = this.nextSpanID
    this.nextSpanID += 1
    const event: SidecarProbeEvent = { at: new Date().toISOString(), name, phase: "start", details }
    this.activeSpans.set(spanID, { startedAt: Date.now(), event })
    this.record(event)
    return spanID
  }

  private patchSpan(spanID: number, patch: SidecarProbeDetails): void {
    const span = this.activeSpans.get(spanID)
    if (!span) return
    span.event = {
      ...span.event,
      details: { ...span.event.details, ...patch },
    }
  }

  private end(spanID: number): void {
    const span = this.activeSpans.get(spanID)
    if (!span) return
    this.activeSpans.delete(spanID)
    const durationMs = Date.now() - span.startedAt
    this.record({ ...span.event, at: new Date().toISOString(), phase: "end", durationMs })
    if (durationMs >= this.slowThresholdMs) this.log(`SIDECAR PROBE slow ${span.event.name} duration=${durationMs}ms`)
  }

  private fail(spanID: number, error: unknown): void {
    const span = this.activeSpans.get(spanID)
    if (!span) return
    this.activeSpans.delete(spanID)
    const durationMs = Date.now() - span.startedAt
    this.record({
      ...span.event,
      at: new Date().toISOString(),
      phase: "error",
      durationMs,
      details: { ...span.event.details, error: errorMessage(error) },
    })
  }

  private record(event: SidecarProbeEvent): void {
    this.recentEvents.push(event)
    while (this.recentEvents.length > this.maxEvents) this.recentEvents.shift()
    if (isStickyEvent(event.name)) {
      this.stickyEvents.push(event)
      while (this.stickyEvents.length > this.stickyMax) this.stickyEvents.shift()
    }
  }
}

function isStickyEvent(name: string): boolean {
  return (
    name.startsWith("Tool.") ||
    name.startsWith("ShellTool.") ||
    name.startsWith("MCP.tool") ||
    name === "Tool.execute" ||
    name.startsWith("Tool.execute.")
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
