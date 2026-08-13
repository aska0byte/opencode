import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Image } from "@/image/image"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Deferred, Duration, Effect, Exit, Layer, Context, Scope, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionDiagnostics } from "@/diagnostics/session"
import { SessionProgress } from "@/diagnostics/session-progress"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { Usage, type LLMEvent } from "@opencode-ai/llm"
import { recordStep } from "@opencode-ai/usage-stats/service"

const DOOM_LOOP_THRESHOLD = 3
/** Handoff wait after stream drain for leftover tools that never produced a result. */
export function toolResultHandoffTimeoutMs(): number {
  const raw = process.env.OPENCODE_TOOL_HANDOFF_TIMEOUT_MS
  if (raw !== undefined && raw !== "") {
    const ms = Number(raw)
    if (Number.isFinite(ms) && ms >= 0) return Math.floor(ms)
  }
  return Duration.toMillis(LLM.LLM_STREAM_IDLE_TIMEOUT)
}

/** True-idle budget while the LLM stream emits no events and no tools are in flight. */
export function llmStreamIdleTimeoutMs(): number {
  const raw = process.env.OPENCODE_LLM_STREAM_IDLE_TIMEOUT_MS
  if (raw !== undefined && raw !== "") {
    const ms = Number(raw)
    if (Number.isFinite(ms) && ms >= 0) return Math.floor(ms)
  }
  return Duration.toMillis(LLM.LLM_STREAM_IDLE_TIMEOUT)
}
export type Result = "compact" | "stop" | "continue"

export interface Handle {
  readonly message: SessionV1.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
  ) => Effect.Effect<SessionV1.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: SessionV1.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: SessionV1.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: SessionV1.ToolPart["id"]
  messageID: SessionV1.ToolPart["messageID"]
  sessionID: SessionV1.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
  release: Effect.Effect<void>
  /** Last tool input seen on tool-call (survives pending/running PartUpdated batch lag). */
  lastInput?: Record<string, any>
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  idleTimedOut: boolean
  currentText: SessionV1.TextPart | undefined
  reasoningMap: Record<string, SessionV1.ReasoningPart>
}

type StreamEvent = LLMEvent

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const image = yield* Image.Service
    const events = yield* EventV2Bridge.Service
    const database = yield* Database.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        idleTimedOut: false,
        currentText: undefined,
        reasoningMap: {},
      }
      let aborted = false

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const handoffDetails = (callID: string, tool?: string) => ({
        sessionID: ctx.sessionID,
        messageID: ctx.assistantMessage.id,
        callID,
        tool,
        pendingToolCalls: Object.keys(ctx.toolcalls).length,
      })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        delete ctx.toolcalls[toolCallID]
        if (!call) return
        yield* Deferred.succeed(call.done, undefined).pipe(Effect.ignore)
        yield* call.release
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          yield* settleToolCall(toolCallID)
          return undefined
        }
        return { call, part }
      })

      /**
       * Terminal tool-result/error must accept both pending and running.
       * Running PartUpdated is last-wins batched (~100ms); tool-result can arrive
       * before that flush, so getPart may still show pending.
       */
      const resolveOpenTool = Effect.fn("SessionProcessor.resolveOpenTool")(function* (
        toolCallID: string,
        eventType: string,
        tool?: string,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (match) {
          if (match.part.state.status === "running" || match.part.state.status === "pending") {
            return { part: match.part, call: match.call, tracked: true as const }
          }
          // Already terminal but Deferred may still be held — release so cleanup cannot hang.
          yield* settleToolCall(toolCallID)
          return undefined
        }
        const parts = yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
          Effect.provideService(Database.Service, database),
        )
        const part = parts.find(
          (item): item is SessionV1.ToolPart =>
            item.type === "tool" &&
            item.callID === toolCallID &&
            (item.state.status === "running" || item.state.status === "pending"),
        )
        if (!part) {
          SessionDiagnostics.markToolHandoffUnmatched({
            ...handoffDetails(toolCallID, tool),
            eventType,
          })
          return undefined
        }
        SessionDiagnostics.markToolHandoff({
          ...handoffDetails(toolCallID, tool ?? part.tool),
          eventType,
          phase: "recovered-from-parts",
        })
        return { part, call: undefined, tracked: false as const }
      })

      const openToolStart = (part: SessionV1.ToolPart) => {
        if (part.state.status === "running") return part.state.time.start
        return Date.now()
      }

      const openToolInput = (part: SessionV1.ToolPart, lastInput?: Record<string, any>): Record<string, any> => {
        if (lastInput && Object.keys(lastInput).length > 0) return lastInput
        if (part.state.status === "pending" || part.state.status === "running") {
          return isRecord(part.state.input) ? part.state.input : {}
        }
        return {}
      }

      const openToolMetadata = (part: SessionV1.ToolPart): Record<string, unknown> => {
        if ("metadata" in part.state && isRecord(part.state.metadata)) return part.state.metadata
        return {}
      }

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return undefined
        const part = yield* session.updatePart(update(match.part))
        const lastInput =
          (part.state.status === "running" || part.state.status === "pending") && isRecord(part.state.input)
            ? part.state.input
            : match.call.lastInput
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
          lastInput,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: SessionV1.FilePart[]
        },
      ) {
        const resolved = yield* resolveOpenTool(toolCallID, "tool-result")
        if (!resolved) return
        const part = resolved.part
        const start = openToolStart(part)
        const input = openToolInput(part, resolved.call?.lastInput)
        SessionDiagnostics.markToolHandoff({
          ...handoffDetails(toolCallID, part.tool),
          eventType: "tool-result",
          phase: "persist-start",
        })
        yield* session
          .updatePart({
            ...part,
            state: {
              status: "completed",
              input,
              output: output.output,
              metadata: output.metadata,
              title: output.title,
              time: { start, end: Date.now() },
              attachments: output.attachments,
            },
          })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                SessionDiagnostics.markToolHandoff({
                  ...handoffDetails(toolCallID, part.tool),
                  eventType: "tool-result",
                  phase: "persist-end",
                })
              }),
            ),
            Effect.tapError((error) =>
              Effect.sync(() => {
                SessionDiagnostics.markToolHandoff({
                  ...handoffDetails(toolCallID, part.tool),
                  eventType: "tool-result",
                  phase: "persist-error",
                  error: errorMessage(error),
                })
              }),
            ),
            // Always release Deferred/blocker so cleanup cannot hang on persist failure.
            Effect.ensuring(resolved.tracked ? settleToolCall(toolCallID) : Effect.void),
          )
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (
        toolCallID: string,
        error: unknown,
        eventType = "tool-error",
      ) {
        const resolved = yield* resolveOpenTool(toolCallID, eventType)
        if (!resolved) return false
        const part = resolved.part
        const start = openToolStart(part)
        const input = openToolInput(part, resolved.call?.lastInput)
        const metadata = openToolMetadata(part)
        SessionDiagnostics.markToolHandoff({
          ...handoffDetails(toolCallID, part.tool),
          eventType,
          phase: "persist-start",
          error: errorMessage(error),
        })
        yield* session
          .updatePart({
            ...part,
            state: {
              status: "error",
              input,
              error: errorMessage(error),
              // Keep metadata streamed while running so failures retain progress detail (e.g. execute's child calls).
              metadata,
              time: { start, end: Date.now() },
            },
          })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                SessionDiagnostics.markToolHandoff({
                  ...handoffDetails(toolCallID, part.tool),
                  eventType,
                  phase: "persist-end",
                })
              }),
            ),
            Effect.tapError((err) =>
              Effect.sync(() => {
                SessionDiagnostics.markToolHandoff({
                  ...handoffDetails(toolCallID, part.tool),
                  eventType,
                  phase: "persist-error",
                  error: errorMessage(err),
                })
              }),
            ),
            Effect.ensuring(resolved.tracked ? settleToolCall(toolCallID) : Effect.void),
          )
        if (error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        return true
      })

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        delete ctx.reasoningMap[reasoningID]
      })

      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (input: {
        id: string
        name: string
        providerExecuted?: boolean
      }) {
        const existing = yield* readToolCall(input.id)
        if (existing) {
          if (!input.providerExecuted || existing.part.metadata?.providerExecuted) return existing
          const part = yield* session.updatePart({
            ...existing.part,
            metadata: { ...existing.part.metadata, providerExecuted: true },
          })
          ctx.toolcalls[input.id] = {
            ...existing.call,
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
          return { call: ctx.toolcalls[input.id], part }
        }
        const part = yield* session.updatePart({
          id: PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: input.providerExecuted ? { providerExecuted: true } : undefined,
        } satisfies SessionV1.ToolPart)
        const release = yield* status.acquire(ctx.sessionID)
        ctx.toolcalls[input.id] = {
          done: yield* Deferred.make<void>(),
          release,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      const isFilePart = (value: unknown): value is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(value)

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: SessionV1.FilePart[] } => {
        if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
          return {
            title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
            metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
            output: value.result.value.output,
            attachments: Array.isArray(value.result.value.attachments)
              ? value.result.value.attachments.filter(isFilePart)
              : undefined,
          }
        }
        return {
          title: value.name,
          metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
          output:
            typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
        }
      }

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            // Match dev: silently drop orphan deltas (no preceding reasoning-start).
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (value.providerMetadata && value.id in ctx.reasoningMap) {
              ctx.reasoningMap[value.id].metadata = value.providerMetadata
            }
            yield* finishReasoning(value.id)
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            return

          case "tool-input-delta":
            yield* ensureToolCall(value)
            return

          case "tool-input-end": {
            yield* ensureToolCall(value)
            return
          }

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            yield* ensureToolCall(value)
            const input = isRecord(value.input) ? value.input : { value: value.input }
            yield* updateToolCall(value.id, (match) => ({
              ...match,
              tool: value.name,
              state:
                match.state.status === "running"
                  ? { ...match.state, input }
                  : {
                      status: "running",
                      input,
                      time: { start: Date.now() },
                    },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))

            const parts = yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
              Effect.provideService(Database.Service, database),
            )
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.name &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.name],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.name, input },
              always: [value.name],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            SessionDiagnostics.markToolHandoff({
              ...handoffDetails(value.id, value.name),
              eventType: "tool-result",
              phase: "receive",
            })
            if (value.result.type === "error") {
              yield* failToolCall(value.id, value.result.value, "tool-result")
              return
            }
            const rawOutput = toolResultOutput(value)
            const normalized = yield* Effect.forEach(rawOutput.attachments ?? [], (attachment) =>
              attachment.mime.startsWith("image/")
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      (error) => error instanceof Image.ResizerUnavailableError,
                      () => Effect.succeed(attachment),
                    ),
                    Effect.exit,
                  )
                : Effect.succeed(Exit.succeed<SessionV1.FilePart>(attachment)),
            )
            const omitted = normalized.filter(Exit.isFailure).length
            const attachments = normalized.filter(Exit.isSuccess).map((item) => item.value)
            const output = {
              ...rawOutput,
              output:
                omitted === 0
                  ? rawOutput.output
                  : `${rawOutput.output}\n\n[${omitted} image${omitted === 1 ? "" : "s"} omitted: could not be resized below the image size limit.]`,
              attachments: attachments.length ? attachments : undefined,
            }
            yield* completeToolCall(value.id, output)
            return
          }

          case "tool-error": {
            SessionDiagnostics.markToolHandoff({
              ...handoffDetails(value.id, value.name),
              eventType: "tool-error",
              phase: "receive",
            })
            yield* failToolCall(value.id, value.error ?? new Error(value.message), "tool-error")
            return
          }

          case "provider-error":
            throw new Error(value.message)

          case "step-start":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "step-finish": {
            const completedSnapshot = yield* snapshot.track()
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            ctx.assistantMessage.finish = value.reason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.reason,
              snapshot: completedSnapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            yield* recordStep({
              sessionID: ctx.sessionID,
              providerID: ctx.model.providerID,
              modelID: ctx.model.id,
              tokensIn: usage.tokens.input + usage.tokens.cache.read + usage.tokens.cache.write,
              tokensOut: usage.tokens.output,
              tokensReasoning: usage.tokens.reasoning,
              tokensCacheRead: usage.tokens.cache.read,
              tokensCacheWrite: usage.tokens.cache.write,
            }).pipe(
              Effect.provideService(Database.Service, database),
              Effect.tapError((e) => Effect.log("recordStep failed: " + String(e))),
              Effect.ignore,
              Effect.forkIn(scope),
            )
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            return
          }

          case "text-start":
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        SessionDiagnostics.markStreamCleanup(
          SessionDiagnostics.streamDetails({
            sessionID: ctx.sessionID,
            messageID: ctx.assistantMessage.id,
            providerID: ctx.model.providerID,
            modelID: ctx.model.id,
          }),
          Object.keys(ctx.toolcalls).length,
          Object.keys(ctx.reasoningMap).length,
          ctx.currentText !== undefined,
        )
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        // Short settle only. Long leftover waits live in waitForLeftoverTools
        // (interruptible) so Stop is not stuck inside Effect.ensuring.
        const cleanupDetails = SessionDiagnostics.streamDetails({
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          providerID: ctx.model.providerID,
          modelID: ctx.model.id,
        })
        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )
        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = openToolMetadata(part)
          yield* session.updatePart({
            ...part,
            state: aborted
              ? {
                  status: "error",
                  input: openToolInput(part, match.call.lastInput),
                  error: "Tool execution aborted",
                  metadata: { ...metadata, interrupted: true },
                  time: { start: openToolStart(part), end },
                }
              : {
                  status: "error",
                  input: openToolInput(part, match.call.lastInput),
                  error: "Tool result handoff timed out",
                  metadata: { ...metadata, handoffTimeout: true, interrupted: false },
                  time: { start: openToolStart(part), end },
                },
          })
          yield* settleToolCall(toolCallID)
        }
        SessionDiagnostics.markStreamCleanupEnd(cleanupDetails, 0, false)
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const waitForLeftoverTools = Effect.fn("SessionProcessor.waitForLeftoverTools")(function* () {
        if (aborted) return
        const pending = Object.keys(ctx.toolcalls).length
        if (pending <= 0) return
        const cleanupDetails = SessionDiagnostics.streamDetails({
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          providerID: ctx.model.providerID,
          modelID: ctx.model.id,
        })
        SessionDiagnostics.markStreamCleanupWait(cleanupDetails, pending)
        const timeoutMs = toolResultHandoffTimeoutMs()
        const timedOut = yield* Effect.forEach(Object.values(ctx.toolcalls), (call) => Deferred.await(call.done), {
          concurrency: "unbounded",
          discard: true,
        }).pipe(
          Effect.as(false),
          Effect.timeoutOrElse({
            duration: `${timeoutMs} millis`,
            orElse: () => Effect.succeed(true),
          }),
        )
        if (timedOut) {
          const remaining = Object.keys(ctx.toolcalls).length
          SessionDiagnostics.markStreamCleanupTimeout(cleanupDetails, remaining, timeoutMs)
          for (const toolCallID of Object.keys(ctx.toolcalls)) {
            const match = yield* readToolCall(toolCallID)
            if (!match) continue
            const part = match.part
            const end = Date.now()
            const metadata = openToolMetadata(part)
            yield* session.updatePart({
              ...part,
              state: {
                status: "error",
                input: openToolInput(part, match.call.lastInput),
                error: "Tool result handoff timed out",
                metadata: { ...metadata, handoffTimeout: true, interrupted: false },
                time: { start: openToolStart(part), end },
              },
            })
            yield* settleToolCall(toolCallID)
          }
        }
        SessionDiagnostics.markStreamCleanupEnd(cleanupDetails, Object.keys(ctx.toolcalls).length, timedOut)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        yield* Effect.logError("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
          error: errorMessage(e),
          stack: e instanceof Error ? e.stack : undefined,
        })
        const error = parse(e)
        if (SessionV1.ContextOverflowError.isInstance(error)) {
          if ((yield* config.get()).compaction?.auto === false && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          ctx.needsCompaction = true
          yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        ctx.assistantMessage.error = error
        yield* events.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        yield* Effect.logInfo("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
        })
        ctx.needsCompaction = false
        ctx.idleTimedOut = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          const progress = SessionProgress.stream({
            sessionID: ctx.sessionID,
            messageID: ctx.assistantMessage.id,
            providerID: ctx.model.providerID,
            modelID: ctx.model.id,
          })
          let progressReason = "unknown"
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            yield* status.set(ctx.sessionID, { type: "busy" })
            const stream = llm.stream(streamInput)
            let eventCount = 0
            const eventTypes: Record<string, number> = {}
            const streamDetails = SessionDiagnostics.streamDetails({
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              providerID: ctx.model.providerID,
              modelID: ctx.model.id,
            })
            SessionDiagnostics.markStreamOpen(streamDetails)
            progress.start()

            yield* SessionDiagnostics.span(
              "SessionProcessor.stream",
              streamDetails,
              Effect.gen(function* () {
                SessionDiagnostics.markStreamDrainStart(streamDetails)
                let lastEventAt = Date.now()
                const idleBudgetMs = llmStreamIdleTimeoutMs()
                const drain = stream.pipe(
                  Stream.tap((event) =>
                    Effect.gen(function* () {
                      lastEventAt = Date.now()
                      eventCount += 1
                      const eventType = SessionDiagnostics.eventType(event)
                      eventTypes[eventType] = (eventTypes[eventType] ?? 0) + 1
                      progress.onEvent(eventType)
                      if (eventCount === 1 || eventCount % 50 === 0) {
                        SessionDiagnostics.markStreamEvent(streamDetails, eventCount, event)
                      }
                      yield* handleEvent(event)
                    }),
                  ),
                  Stream.takeUntil(() => ctx.needsCompaction || ctx.idleTimedOut),
                  Stream.runDrain,
                )
                const watchdog =
                  idleBudgetMs <= 0
                    ? Effect.never
                    : Effect.gen(function* () {
                        while (!ctx.needsCompaction && !aborted && !ctx.idleTimedOut) {
                          yield* Effect.sleep("50 millis")
                          if (Object.keys(ctx.toolcalls).length > 0) continue
                          if (Date.now() - lastEventAt < idleBudgetMs) continue
                          ctx.idleTimedOut = true
                          return
                        }
                      })
                yield* Effect.raceFirst(drain, watchdog)
                SessionDiagnostics.markStreamDrainEnd(
                  streamDetails,
                  eventCount,
                  ctx.needsCompaction,
                  Object.keys(eventTypes).length,
                )
                if (ctx.idleTimedOut) {
                  progressReason = "idle-timeout"
                  SessionDiagnostics.markStreamInterrupted(streamDetails, "idle-timeout")
                } else {
                  progressReason = ctx.needsCompaction ? "compact" : "drain-end"
                }
              }),
            )
            if (!aborted && !ctx.idleTimedOut) {
              yield* waitForLeftoverTools()
            }
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                if (ctx.idleTimedOut) {
                  progressReason = "idle-timeout"
                  SessionDiagnostics.markStreamInterrupted(
                    SessionDiagnostics.streamDetails({
                      sessionID: ctx.sessionID,
                      messageID: ctx.assistantMessage.id,
                      providerID: ctx.model.providerID,
                      modelID: ctx.model.id,
                    }),
                    "idle-timeout",
                  )
                  return
                }
                aborted = true
                progressReason = "interrupt"
                SessionDiagnostics.markStreamInterrupted(
                  SessionDiagnostics.streamDetails({
                    sessionID: ctx.sessionID,
                    messageID: ctx.assistantMessage.id,
                    providerID: ctx.model.providerID,
                    modelID: ctx.model.id,
                  }),
                  "interrupt",
                )
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                set: (info) => {
                  return status.set(ctx.sessionID, {
                    type: "retry",
                    attempt: info.attempt,
                    message: info.message,
                    action: info.action,
                    next: info.next,
                  })
                },
              }),
            ),
            Effect.tapError((error) =>
              Effect.sync(() => {
                const message = errorMessage(error)
                if (/timeout/i.test(message)) {
                  progressReason = "idle-timeout"
                  SessionDiagnostics.markStreamInterrupted(
                    SessionDiagnostics.streamDetails({
                      sessionID: ctx.sessionID,
                      messageID: ctx.assistantMessage.id,
                      providerID: ctx.model.providerID,
                      modelID: ctx.model.id,
                    }),
                    "idle-timeout",
                  )
                } else {
                  progressReason = "error"
                }
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(
              Effect.sync(() => {
                progress.stop(progressReason)
              }),
            ),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [
    Session.node,
    Config.node,
    Snapshot.node,
    Agent.node,
    LLM.node,
    Permission.node,
    Plugin.node,
    SessionSummary.node,
    SessionStatus.node,
    Image.node,
    EventV2Bridge.node,
    Database.node,
  ],
})

export * as SessionProcessor from "./processor"
