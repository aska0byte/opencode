import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const env = LayerNode.compile(LayerNode.group([SessionStatus.node, EventV2Bridge.node]))
const it = testEffect(env)

describe("SessionStatus blockers", () => {
  it.instance("keeps busy after runner idle while blockers remain", () =>
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const id = SessionID.make("ses_status_blocker_idle")

      yield* status.set(id, { type: "busy" })
      expect(yield* status.get(id)).toEqual({ type: "busy" })

      const release = yield* status.acquire(id)
      expect(yield* status.get(id)).toEqual({ type: "busy" })

      // Runner finished; blockers must still report busy (fixes false OMO idle).
      yield* status.set(id, { type: "idle" })
      expect(yield* status.get(id)).toEqual({ type: "busy" })
      expect((yield* status.list()).has(id)).toBe(true)

      yield* release
      expect(yield* status.get(id)).toEqual({ type: "idle" })
      expect((yield* status.list()).has(id)).toBe(false)
    }),
  )

  it.instance("acquire alone marks busy until release; release is one-shot", () =>
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const id = SessionID.make("ses_status_blocker_oneshot")

      expect(yield* status.get(id)).toEqual({ type: "idle" })
      const release = yield* status.acquire(id)
      expect(yield* status.get(id)).toEqual({ type: "busy" })

      yield* release
      expect(yield* status.get(id)).toEqual({ type: "idle" })

      // Second release must not underflow blockers / throw.
      yield* release
      expect(yield* status.get(id)).toEqual({ type: "idle" })
    }),
  )

  it.instance("stacked acquires require matching releases; retry runner preserved until idle", () =>
    Effect.gen(function* () {
      const status = yield* SessionStatus.Service
      const id = SessionID.make("ses_status_blocker_stack")
      const retry = { type: "retry" as const, attempt: 1, message: "wait", next: Date.now() + 1000 }

      yield* status.set(id, retry)
      const r1 = yield* status.acquire(id)
      const r2 = yield* status.acquire(id)
      expect(yield* status.get(id)).toEqual(retry)

      yield* status.set(id, { type: "idle" })
      // blockers remain → effective busy (runner cleared)
      expect(yield* status.get(id)).toEqual({ type: "busy" })

      yield* r1
      expect(yield* status.get(id)).toEqual({ type: "busy" })
      yield* r2
      expect(yield* status.get(id)).toEqual({ type: "idle" })
    }),
  )
})