import { Effect } from "effect"
import { SidecarDiagnostics } from "./sidecar"
import { SessionProgress } from "./session-progress"

// Was 24ms (local 2026-07-10). Raise to 100ms to cut PartDelta bus churn on busy shells.
const DEFAULT_FLUSH_MS = 100
const DEFAULT_MAX_CHARS = 8_192

export type PartDeltaInput = {
  readonly sessionID: string
  readonly messageID: string
  readonly partID: string
  readonly field: string
  readonly delta: string
}

type Pending = {
  readonly sessionID: string
  readonly messageID: string
  readonly partID: string
  readonly field: string
  delta: string
  chunks: number
}

/**
 * Coalesces high-frequency PartDelta events into short batches before publish.
 * Callers that do not need batching should publish immediately; this class only
 * buffers when used by Session.updatePartDelta.
 */
export class PartDeltaBatcher {
  private readonly pending = new Map<string, Pending>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly publish: (input: PartDeltaInput) => Effect.Effect<void>,
    private readonly flushMs = DEFAULT_FLUSH_MS,
    private readonly maxChars = DEFAULT_MAX_CHARS,
  ) {}

  enqueue(input: PartDeltaInput): Effect.Effect<void> {
    return Effect.suspend(() => {
      const key = partKey(input)
      const existing = this.pending.get(key)
      if (existing) {
        existing.delta += input.delta
        existing.chunks += 1
      } else {
        this.pending.set(key, {
          sessionID: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
          field: input.field,
          delta: input.delta,
          chunks: 1,
        })
      }

      const item = this.pending.get(key)
      if (item && item.delta.length >= this.maxChars) return this.flushKey(key)

      {
        let totalChunks = 0
        let totalChars = 0
        for (const pending of this.pending.values()) {
          totalChunks += pending.chunks
          totalChars += pending.delta.length
        }
        SessionProgress.markPartDeltaPending({
          pendingKeys: this.pending.size,
          totalChunks,
          totalChars,
        })
      }

      this.schedule()
      return Effect.void
    })
  }

  /** Flush deltas for one part before a full PartUpdated publish. */
  flushPart(sessionID: string, messageID: string, partID: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const prefix = `${sessionID}\0${messageID}\0${partID}\0`
      const keys = [...this.pending.keys()].filter((key) => key.startsWith(prefix))
      return Effect.forEach(keys, (key) => this.flushKey(key), { discard: true })
    })
  }

  flushAll(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = undefined
      }
      const keys = [...this.pending.keys()]
      return Effect.forEach(keys, (key) => this.flushKey(key), { discard: true })
    })
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void Effect.runPromise(this.flushAll()).catch((error) => {
        SidecarDiagnostics.mark("Session.partDelta.flush.error", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, this.flushMs)
    // Do not keep the process alive solely for delta flush.
    this.timer.unref?.()
  }

  private flushKey(key: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const item = this.pending.get(key)
      if (!item || !item.delta) {
        this.pending.delete(key)
        return Effect.void
      }
      this.pending.delete(key)
      if (item.chunks > 1 || item.delta.length >= 256) {
        SessionProgress.markPartDeltaFlush({
          sessionID: item.sessionID,
          messageID: item.messageID,
          partID: item.partID,
          field: item.field,
          chunks: item.chunks,
          length: item.delta.length,
          pendingRemaining: this.pending.size,
        })
      }
      return this.publish({
        sessionID: item.sessionID,
        messageID: item.messageID,
        partID: item.partID,
        field: item.field,
        delta: item.delta,
      })
    })
  }
}

function partKey(input: PartDeltaInput): string {
  return `${input.sessionID}\0${input.messageID}\0${input.partID}\0${input.field}`
}
