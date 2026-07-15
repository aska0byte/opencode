import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Session as SessionNs } from "@/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { SidecarDiagnostics } from "../../src/diagnostics/sidecar"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

const model = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test"),
}

afterEach(async () => {
  await disposeAllInstances()
  SidecarDiagnostics.clear()
})

const seed = (session: SessionNs.Interface, sessionID: SessionNs.Info["id"], text: string, created = Date.now()) =>
  Effect.gen(function* () {
    const id = MessageID.ascending()
    const partID = PartID.ascending()
    yield* session.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created },
      agent: "test",
      model,
      tools: {},
    } satisfies SessionV1.User)
    yield* session.updatePart({
      id: partID,
      sessionID,
      messageID: id,
      type: "text",
      text,
    } satisfies SessionV1.TextPart)
    return { id, partID }
  })

describe("Session.messages generation cache", () => {
  it.instance("hits cache on sequential full reads without writes", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})
      yield* seed(session, info.id, "hello")

      const marks: Array<Record<string, unknown>> = []
      SidecarDiagnostics.install({
        mark: (name, details) => {
          if (name === "Session.messages.done") marks.push({ name, ...(details ?? {}) })
        },
        begin: () => ({ end: () => undefined, error: () => undefined }),
      })

      try {
        const first = yield* session.messages({ sessionID: info.id })
        const second = yield* session.messages({ sessionID: info.id })
        expect(first.length).toBe(1)
        expect(second.map((item) => item.info.id)).toEqual(first.map((item) => item.info.id))
        expect(second[0]?.parts[0]).toMatchObject({ type: "text", text: "hello" })

        const hits = marks.filter((mark) => mark.cacheHit === true)
        expect(hits.length).toBeGreaterThanOrEqual(1)
      } finally {
        SidecarDiagnostics.clear()
      }

      yield* session.remove(info.id)
    }),
  )

  it.instance("misses cache after updatePart and returns fresh text", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})
      const { id: messageID, partID } = yield* seed(session, info.id, "before")

      const first = yield* session.messages({ sessionID: info.id })
      expect(first[0]?.parts[0]).toMatchObject({ type: "text", text: "before" })

      yield* session.updatePart({
        id: partID,
        sessionID: info.id,
        messageID,
        type: "text",
        text: "after",
      } satisfies SessionV1.TextPart)

      const second = yield* session.messages({ sessionID: info.id })
      expect(second[0]?.parts[0]).toMatchObject({ type: "text", text: "after" })

      yield* session.remove(info.id)
    }),
  )

  it.instance("coalesces concurrent full reads via singleflight", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const info = yield* session.create({})
      for (let i = 0; i < 3; i++) {
        yield* seed(session, info.id, `m${i}`, Date.now() + i)
      }

      const [a, b, c] = yield* Effect.all(
        [
          session.messages({ sessionID: info.id }),
          session.messages({ sessionID: info.id }),
          session.messages({ sessionID: info.id }),
        ],
        { concurrency: "unbounded" },
      )

      expect(a.length).toBe(3)
      expect(b.map((item) => item.info.id)).toEqual(a.map((item) => item.info.id))
      expect(c.map((item) => item.info.id)).toEqual(a.map((item) => item.info.id))

      yield* session.remove(info.id)
    }),
  )
})
