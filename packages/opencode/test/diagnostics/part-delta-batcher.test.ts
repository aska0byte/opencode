import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PartDeltaBatcher } from "../../src/diagnostics/part-delta-batcher"

describe("PartDeltaBatcher", () => {
  test("coalesces adjacent deltas for the same part field", async () => {
    // given
    const published: string[] = []
    const batcher = new PartDeltaBatcher(
      (input) =>
        Effect.sync(() => {
          published.push(input.delta)
        }),
      5,
      8_192,
    )

    // when
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* batcher.enqueue({
          sessionID: "ses",
          messageID: "msg",
          partID: "part",
          field: "text",
          delta: "hel",
        })
        yield* batcher.enqueue({
          sessionID: "ses",
          messageID: "msg",
          partID: "part",
          field: "text",
          delta: "lo",
        })
        yield* batcher.flushAll()
      }),
    )

    // then
    expect(published).toEqual(["hello"])
  })

  test("flushPart only flushes the matching part", async () => {
    // given
    const published: Array<{ partID: string; delta: string }> = []
    const batcher = new PartDeltaBatcher(
      (input) =>
        Effect.sync(() => {
          published.push({ partID: input.partID, delta: input.delta })
        }),
      60_000,
      8_192,
    )

    // when
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* batcher.enqueue({
          sessionID: "ses",
          messageID: "msg",
          partID: "a",
          field: "text",
          delta: "A",
        })
        yield* batcher.enqueue({
          sessionID: "ses",
          messageID: "msg",
          partID: "b",
          field: "text",
          delta: "B",
        })
        yield* batcher.flushPart("ses", "msg", "a")
      }),
    )

    // then
    expect(published).toEqual([{ partID: "a", delta: "A" }])
  })

  test("flushes immediately when max chars is exceeded", async () => {
    // given
    const published: string[] = []
    const batcher = new PartDeltaBatcher(
      (input) =>
        Effect.sync(() => {
          published.push(input.delta)
        }),
      60_000,
      4,
    )

    // when
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* batcher.enqueue({
          sessionID: "ses",
          messageID: "msg",
          partID: "part",
          field: "text",
          delta: "12345",
        })
      }),
    )

    // then
    expect(published).toEqual(["12345"])
  })
})
