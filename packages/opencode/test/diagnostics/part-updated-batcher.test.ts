import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PartUpdatedBatcher } from "../../src/diagnostics/part-updated-batcher"

type ToolPart = {
  readonly id: string
  readonly sessionID: string
  readonly messageID: string
  readonly type: "tool"
  readonly state: {
    readonly status: "running" | "completed" | "error" | "pending"
    readonly metadata?: { readonly output?: string }
  }
}

function toolPart(
  status: ToolPart["state"]["status"],
  output: string,
  id = "part",
): ToolPart {
  return {
    id,
    sessionID: "ses",
    messageID: "msg",
    type: "tool",
    state: { status, metadata: { output } },
  }
}

describe("PartUpdatedBatcher", () => {
  test("coalesces running tool updates to last-wins on flush", async () => {
    // given
    const published: string[] = []
    const batcher = new PartUpdatedBatcher<ToolPart>(
      (input) =>
        Effect.sync(() => {
          published.push(String(input.part.state.metadata?.output ?? ""))
        }),
      60_000,
    )

    // when
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* batcher.publishPart(toolPart("running", "a"))
        yield* batcher.publishPart(toolPart("running", "ab"))
        yield* batcher.publishPart(toolPart("running", "abc"))
        yield* batcher.flushAll()
      }),
    )

    // then
    expect(published).toEqual(["abc"])
  })

  test("terminal tool status publishes immediately after flushing pending", async () => {
    // given
    const published: Array<{ status: string; output: string }> = []
    const batcher = new PartUpdatedBatcher<ToolPart>(
      (input) =>
        Effect.sync(() => {
          published.push({
            status: input.part.state.status,
            output: String(input.part.state.metadata?.output ?? ""),
          })
        }),
      60_000,
    )

    // when
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* batcher.publishPart(toolPart("running", "partial"))
        yield* batcher.publishPart(toolPart("completed", "final"))
      }),
    )

    // then — terminal supersedes pending running; only one immediate publish
    expect(published).toEqual([{ status: "completed", output: "final" }])
  })

  test("non-tool parts publish immediately without batching", async () => {
    // given
    type TextPart = {
      readonly id: string
      readonly sessionID: string
      readonly messageID: string
      readonly type: "text"
      readonly text: string
    }
    const published: string[] = []
    const batcher = new PartUpdatedBatcher<TextPart>(
      (input) =>
        Effect.sync(() => {
          published.push(input.part.text)
        }),
      60_000,
    )

    // when
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* batcher.publishPart({
          id: "t1",
          sessionID: "ses",
          messageID: "msg",
          type: "text",
          text: "hello",
        })
      }),
    )

    // then
    expect(published).toEqual(["hello"])
  })
})
