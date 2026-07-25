import { SidecarDiagnostics, type Details } from "./sidecar"

const STREAM_HEARTBEAT_MS = 15_000
const MESSAGES_SLOW_MS = 100
const PART_DELTA_PENDING_MARK_THRESHOLD = 8

export type StreamProgressDetails = {
  readonly sessionID: string
  readonly messageID: string
  readonly providerID: string
  readonly modelID: string
}

/**
 * Progress/wait probes for long freezes.
 * All marks no-op when diagnostics probe bridge is not installed.
 */
export class SessionProgress {
  static stream(details: StreamProgressDetails): StreamProgressHandle {
    return new StreamProgressHandle(details)
  }

  static markPermissionAsk(input: {
    readonly id: string
    readonly sessionID: string
    readonly permission: string
    readonly patternCount: number
    readonly toolCallID?: string | null
  }): void {
    SidecarDiagnostics.mark("Permission.ask", {
      id: input.id,
      sessionID: input.sessionID,
      permission: input.permission,
      patternCount: input.patternCount,
      toolCallID: input.toolCallID ?? null,
    })
  }

  static markPermissionWaitEnd(input: {
    readonly id: string
    readonly sessionID: string
    readonly permission: string
    readonly waitMs: number
    readonly outcome: "resolved" | "rejected" | "corrected"
  }): void {
    SidecarDiagnostics.mark("Permission.wait.end", {
      id: input.id,
      sessionID: input.sessionID,
      permission: input.permission,
      waitMs: input.waitMs,
      outcome: input.outcome,
    })
  }

  static markPermissionReply(input: {
    readonly id: string
    readonly sessionID: string
    readonly reply: string
  }): void {
    SidecarDiagnostics.mark("Permission.reply", {
      id: input.id,
      sessionID: input.sessionID,
      reply: input.reply,
    })
  }

  static markQuestionAsk(input: {
    readonly id: string
    readonly sessionID: string
    readonly questionCount: number
    readonly toolCallID?: string | null
  }): void {
    SidecarDiagnostics.mark("Question.ask", {
      id: input.id,
      sessionID: input.sessionID,
      questionCount: input.questionCount,
      toolCallID: input.toolCallID ?? null,
    })
  }

  static markQuestionWaitEnd(input: {
    readonly id: string
    readonly sessionID: string
    readonly waitMs: number
    readonly outcome: "answered" | "rejected"
  }): void {
    SidecarDiagnostics.mark("Question.wait.end", {
      id: input.id,
      sessionID: input.sessionID,
      waitMs: input.waitMs,
      outcome: input.outcome,
    })
  }

  static markQuestionReply(input: {
    readonly id: string
    readonly sessionID: string
    readonly answerCount: number
  }): void {
    SidecarDiagnostics.mark("Question.reply", {
      id: input.id,
      sessionID: input.sessionID,
      answerCount: input.answerCount,
    })
  }

  static markMessagesDone(input: {
    readonly sessionID: string
    readonly limit: number | null
    readonly count: number
    readonly pages: number
    readonly durationMs: number
    readonly cacheHit?: boolean
    readonly generation?: number
  }): void {
    // Always record cache hits so thrash dumps can show coalesced reads.
    if (!input.cacheHit && input.durationMs < MESSAGES_SLOW_MS && input.pages <= 1) return
    SidecarDiagnostics.mark("Session.messages.done", {
      sessionID: input.sessionID,
      limit: input.limit,
      count: input.count,
      pages: input.pages,
      durationMs: input.durationMs,
      cacheHit: input.cacheHit ?? false,
      generation: input.generation ?? null,
    })
  }

  static markPartDeltaPending(input: {
    readonly pendingKeys: number
    readonly totalChunks: number
    readonly totalChars: number
  }): void {
    if (input.pendingKeys < PART_DELTA_PENDING_MARK_THRESHOLD) return
    SidecarDiagnostics.mark("Session.partDelta.pending", {
      pendingKeys: input.pendingKeys,
      totalChunks: input.totalChunks,
      totalChars: input.totalChars,
    })
  }

  static markPartDeltaFlush(input: {
    readonly sessionID: string
    readonly messageID: string
    readonly partID: string
    readonly field: string
    readonly chunks: number
    readonly length: number
    readonly pendingRemaining: number
  }): void {
    SidecarDiagnostics.mark("Session.partDelta.flush", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.partID,
      field: input.field,
      chunks: input.chunks,
      length: input.length,
      pendingRemaining: input.pendingRemaining,
    })
  }

  static markPartUpdatedPending(input: { readonly pendingKeys: number }): void {
    if (input.pendingKeys < PART_DELTA_PENDING_MARK_THRESHOLD) return
    SidecarDiagnostics.mark("Session.partUpdated.pending", {
      pendingKeys: input.pendingKeys,
    })
  }

  static markPartUpdatedFlush(input: {
    readonly sessionID: string
    readonly messageID: string
    readonly partID: string
    readonly updates: number
    readonly pendingRemaining: number
  }): void {
    SidecarDiagnostics.mark("Session.partUpdated.flush", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      partID: input.partID,
      updates: input.updates,
      pendingRemaining: input.pendingRemaining,
    })
  }
}

export class StreamProgressHandle {
  private readonly startedAt = Date.now()
  private lastEventAt = this.startedAt
  private lastEventType: string | null = null
  private eventCount = 0
  private firstEventMs: number | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private stopped = false

  constructor(private readonly details: StreamProgressDetails) {}

  start(): void {
    if (this.heartbeatTimer || this.stopped) return
    this.heartbeatTimer = setInterval(() => this.heartbeat(), STREAM_HEARTBEAT_MS)
    this.heartbeatTimer.unref?.()
  }

  onEvent(eventType: string): void {
    if (this.stopped) return
    this.eventCount += 1
    this.lastEventAt = Date.now()
    this.lastEventType = eventType
    if (this.firstEventMs === null) {
      this.firstEventMs = this.lastEventAt - this.startedAt
      SidecarDiagnostics.mark("SessionProcessor.stream.firstEvent", {
        ...this.baseDetails(),
        firstEventMs: this.firstEventMs,
        eventType,
      })
    }
  }

  stop(reason: string): void {
    if (this.stopped) return
    this.stopped = true
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
    SidecarDiagnostics.mark("SessionProcessor.stream.progress.end", {
      ...this.baseDetails(),
      reason,
      elapsedMs: Date.now() - this.startedAt,
      sinceLastEventMs: Date.now() - this.lastEventAt,
      eventCount: this.eventCount,
      firstEventMs: this.firstEventMs,
      lastEventType: this.lastEventType,
    })
  }

  private heartbeat(): void {
    if (this.stopped) return
    const now = Date.now()
    SidecarDiagnostics.mark("SessionProcessor.stream.heartbeat", {
      ...this.baseDetails(),
      elapsedMs: now - this.startedAt,
      sinceLastEventMs: now - this.lastEventAt,
      eventCount: this.eventCount,
      firstEventMs: this.firstEventMs,
      lastEventType: this.lastEventType,
    })
  }

  private baseDetails(): Details {
    return {
      sessionID: this.details.sessionID,
      messageID: this.details.messageID,
      providerID: this.details.providerID,
      modelID: this.details.modelID,
    }
  }
}
