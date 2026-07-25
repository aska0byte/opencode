import { Effect } from "effect"
import { SidecarDiagnostics } from "./sidecar"
import { SessionProgress } from "./session-progress"

const DEFAULT_FLUSH_MS = 100

export type PartUpdatedInput<TPart> = {
  readonly sessionID: string
  readonly part: TPart
  readonly time: number
}

type Pending<TPart> = {
  readonly sessionID: string
  readonly messageID: string
  readonly partID: string
  part: TPart
  time: number
  updates: number
}

type BatchablePart = {
  readonly id: string
  readonly sessionID: string
  readonly messageID: string
  readonly type: string
  readonly state?: {
    readonly status?: string
  }
}

/**
 * Coalesces high-frequency PartUpdated publishes for tool parts in `running`
 * status (last-wins snapshot). Terminal / non-running updates flush pending
 * work for that part and publish immediately so model-visible end state is not delayed.
 */
export class PartUpdatedBatcher<TPart extends BatchablePart> {
  private readonly pending = new Map<string, Pending<TPart>>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly publish: (input: PartUpdatedInput<TPart>) => Effect.Effect<void>,
    private readonly flushMs = DEFAULT_FLUSH_MS,
  ) {}

  publishPart(part: TPart): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (isRunningToolPart(part)) return this.enqueueRunning(part)
      // Terminal / non-running snapshot supersedes any pending running snapshot.
      this.dropPending(part.sessionID, part.messageID, part.id)
      return this.publish({
        sessionID: part.sessionID,
        part: structuredClone(part),
        time: Date.now(),
      })
    })
  }

  private dropPending(sessionID: string, messageID: string, partID: string): void {
    this.pending.delete(partKey(sessionID, messageID, partID))
  }

  flushPart(sessionID: string, messageID: string, partID: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const key = partKey(sessionID, messageID, partID)
      return this.flushKey(key)
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

  private enqueueRunning(part: TPart): Effect.Effect<void> {
    return Effect.suspend(() => {
      const key = partKey(part.sessionID, part.messageID, part.id)
      const existing = this.pending.get(key)
      if (existing) {
        existing.part = structuredClone(part)
        existing.time = Date.now()
        existing.updates += 1
      } else {
        this.pending.set(key, {
          sessionID: part.sessionID,
          messageID: part.messageID,
          partID: part.id,
          part: structuredClone(part),
          time: Date.now(),
          updates: 1,
        })
      }
      SessionProgress.markPartUpdatedPending({ pendingKeys: this.pending.size })
      this.schedule()
      return Effect.void
    })
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void Effect.runPromise(this.flushAll()).catch((error) => {
        SidecarDiagnostics.mark("Session.partUpdated.flush.error", {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, this.flushMs)
    this.timer.unref?.()
  }

  private flushKey(key: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const item = this.pending.get(key)
      if (!item) return Effect.void
      this.pending.delete(key)
      if (item.updates > 1) {
        SessionProgress.markPartUpdatedFlush({
          sessionID: item.sessionID,
          messageID: item.messageID,
          partID: item.partID,
          updates: item.updates,
          pendingRemaining: this.pending.size,
        })
      }
      return this.publish({
        sessionID: item.sessionID,
        part: item.part,
        time: item.time,
      })
    })
  }
}

export function isRunningToolPart(part: BatchablePart): boolean {
  return part.type === "tool" && part.state?.status === "running"
}

function partKey(sessionID: string, messageID: string, partID: string): string {
  return `${sessionID}\0${messageID}\0${partID}`
}
