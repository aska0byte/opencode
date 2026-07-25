import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "./schema"
import { Effect, Layer, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"

export const Info = SessionStatusEvent.Info
export type Info = SessionStatusEvent.Info

export const Event = SessionStatusEvent

/** Non-idle runner status written by SessionRunState (busy | retry). */
type RunnerStatus = Exclude<Info, { type: "idle" }>

type Entry = {
  runner?: RunnerStatus
  blockers: number
}

export interface Interface {
  readonly get: (sessionID: SessionID) => Effect.Effect<Info>
  readonly list: () => Effect.Effect<Map<SessionID, Info>>
  readonly set: (sessionID: SessionID, status: Info) => Effect.Effect<void>
  /**
   * Hold an internal activity lease so the session stays effectively busy until
   * the returned one-shot release runs (e.g. unsettled tool calls, parent bg jobs).
   * Does not change the public idle|busy|retry protocol shape — only delays idle.
   */
  readonly acquire: (sessionID: SessionID) => Effect.Effect<Effect.Effect<void>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStatus") {}

function effective(entry: Entry | undefined): Info {
  if (!entry) return { type: "idle" as const }
  if (entry.runner) return entry.runner
  if (entry.blockers > 0) return { type: "busy" as const }
  return { type: "idle" as const }
}

function sameStatus(a: Info, b: Info): boolean {
  if (a.type !== b.type) return false
  if (a.type === "retry" && b.type === "retry") {
    return a.attempt === b.attempt && a.message === b.message && a.next === b.next
  }
  return true
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionStatus.state")(() => Effect.succeed(new Map<SessionID, Entry>())),
    )

    const publishIfChanged = Effect.fn("SessionStatus.publishIfChanged")(function* (
      sessionID: SessionID,
      prev: Info,
      next: Info,
    ) {
      if (sameStatus(prev, next)) return
      yield* events.publish(Event.Status, { sessionID, status: next })
      if (next.type === "idle") {
        yield* events.publish(Event.Idle, { sessionID })
      }
    })

    const write = Effect.fn("SessionStatus.write")(function* (sessionID: SessionID, entry: Entry | undefined) {
      const data = yield* InstanceState.get(state)
      if (!entry || (!entry.runner && entry.blockers <= 0)) {
        data.delete(sessionID)
        return
      }
      data.set(sessionID, entry)
    })

    const get = Effect.fn("SessionStatus.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return effective(data.get(sessionID))
    })

    const list = Effect.fn("SessionStatus.list")(function* () {
      const data = yield* InstanceState.get(state)
      const out = new Map<SessionID, Info>()
      for (const [sessionID, entry] of data) {
        const status = effective(entry)
        if (status.type === "idle") continue
        out.set(sessionID, status)
      }
      return out
    })

    const set = Effect.fn("SessionStatus.set")(function* (sessionID: SessionID, status: Info) {
      const data = yield* InstanceState.get(state)
      const prevEntry = data.get(sessionID)
      const prev = effective(prevEntry)
      const blockers = prevEntry?.blockers ?? 0

      // idle clears runner only; blockers keep the session effectively busy until released.
      const nextEntry: Entry | undefined =
        status.type === "idle"
          ? blockers > 0
            ? { blockers }
            : undefined
          : { runner: status, blockers }

      yield* write(sessionID, nextEntry)
      yield* publishIfChanged(sessionID, prev, effective(nextEntry))
    })

    const acquire = Effect.fn("SessionStatus.acquire")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const prevEntry = data.get(sessionID)
      const prev = effective(prevEntry)
      const nextEntry: Entry = {
        runner: prevEntry?.runner,
        blockers: (prevEntry?.blockers ?? 0) + 1,
      }
      yield* write(sessionID, nextEntry)
      yield* publishIfChanged(sessionID, prev, effective(nextEntry))

      let released = false
      return Effect.fn("SessionStatus.release")(function* () {
        if (released) return
        released = true
        const current = yield* InstanceState.get(state)
        const entry = current.get(sessionID)
        if (!entry || entry.blockers <= 0) return
        const before = effective(entry)
        const afterEntry: Entry | undefined =
          entry.blockers <= 1 && !entry.runner
            ? undefined
            : {
                runner: entry.runner,
                blockers: entry.blockers - 1,
              }
        yield* write(sessionID, afterEntry)
        yield* publishIfChanged(sessionID, before, effective(afterEntry))
      })()
    })

    return Service.of({ get, list, set, acquire })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2Bridge.node] })

export * as SessionStatus from "./status"