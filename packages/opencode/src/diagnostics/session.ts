import { Effect } from "effect"
import type { LLMEvent } from "@opencode-ai/llm"
import { errorMessage } from "@/util/error"
import { isRecord } from "@/util/record"
import { SidecarDiagnostics, type Details } from "./sidecar"

const STRING_DETAIL_FIELDS = ["command", "filePath", "path", "pattern", "query", "server", "uri"] as const

type ToolOutput = {
  readonly output?: string
  readonly attachments?: readonly unknown[]
  readonly metadata?: Record<string, unknown>
}

type McpResult = {
  readonly content: readonly unknown[]
  readonly metadata?: Record<string, unknown>
}

type ShellInput = {
  readonly shell: string
  readonly command: string
  readonly cwd: string
  readonly timeout: number
}

type ShellContext = {
  readonly sessionID: string
  readonly messageID: string
  readonly callID?: string
}

type ShellOutput = {
  readonly exit: number | null
  readonly aborted: boolean
  readonly expired: boolean
  readonly truncated: boolean
  readonly savedToFile: boolean
  readonly outputLength: number
  readonly previewLength: number
}

type StreamDetailsInput = {
  readonly sessionID: string
  readonly messageID: string
  readonly providerID: string
  readonly modelID: string
}

export class SessionDiagnostics {
  static span<A, E, R>(name: string, details: Details, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return SidecarDiagnostics.span(name, details, effect)
  }

  static toolDetails(tool: string, sessionID: string, messageID: string, callID: string | null, args: unknown): Details {
    const record = toRecord(args)
    return {
      tool,
      sessionID,
      messageID,
      callID,
      inputKeys: Object.keys(record).length,
      commandLength: stringFieldLength(record, "command"),
      filePathLength: stringFieldLength(record, "filePath"),
      pathLength: stringFieldLength(record, "path"),
      patternLength: stringFieldLength(record, "pattern"),
      queryLength: stringFieldLength(record, "query"),
      serverLength: stringFieldLength(record, "server"),
      uriLength: stringFieldLength(record, "uri"),
    }
  }

  static markToolBefore(details: Details): void {
    SidecarDiagnostics.mark("Tool.execute.before", details)
    SessionDiagnostics.patchToolPhase(details, "before")
  }

  static markToolRun(details: Details): void {
    SidecarDiagnostics.mark("Tool.execute.run", details)
    SessionDiagnostics.patchToolPhase(details, "run")
  }

  static markToolOutput(details: Details, output: ToolOutput): void {
    SidecarDiagnostics.mark("Tool.execute.output", outputDetails(details, output))
    SessionDiagnostics.patchToolPhase(details, "output")
  }

  static markToolAfter(details: Details): void {
    SidecarDiagnostics.mark("Tool.execute.after", details)
    SessionDiagnostics.patchToolPhase(details, "after")
  }

  /** Phase for active Tool.execute span: before | permission | run | shell | output | after */
  static markToolPhase(details: Details, phase: string, extra?: Details): void {
    const next = { ...details, ...extra, phase }
    SidecarDiagnostics.mark(`Tool.execute.phase.${phase}`, next)
    SessionDiagnostics.patchToolPhase(next, phase)
  }

  private static patchToolPhase(details: Details, phase: string): void {
    const callID = details.callID
    if (typeof callID !== "string" || callID.length === 0) return
    SidecarDiagnostics.patchActiveByCallID(callID, { phase, tool: details.tool ?? null })
  }

  static markMcpBefore(details: Details): void {
    SidecarDiagnostics.mark("MCP.tool.before", details)
  }

  static markMcpPermission(details: Details): void {
    SidecarDiagnostics.mark("MCP.tool.permission", details)
  }

  static markMcpRun(details: Details): void {
    SidecarDiagnostics.mark("MCP.tool.run", details)
  }

  static markMcpResult(details: Details, result: McpResult): void {
    SidecarDiagnostics.mark("MCP.tool.result", mcpResultDetails(details, result))
  }

  static markMcpAfter(details: Details): void {
    SidecarDiagnostics.mark("MCP.tool.after", details)
  }

  static markMcpOutput(details: Details, output: ToolOutput): void {
    SidecarDiagnostics.mark("MCP.tool.output", outputDetails(details, output))
  }

  static streamDetails(input: StreamDetailsInput): Details {
    return {
      sessionID: input.sessionID,
      messageID: input.messageID,
      providerID: input.providerID,
      modelID: input.modelID,
    }
  }

  static markStreamOpen(details: Details): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.open", details)
  }

  static markStreamDrainStart(details: Details): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.drain.start", details)
  }

  static markStreamEvent(details: Details, eventCount: number, event: LLMEvent): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.event", {
      ...details,
      eventCount,
      eventType: llmEventType(event),
    })
  }

  static markStreamDrainEnd(details: Details, eventCount: number, needsCompaction: boolean, eventTypeKinds: number): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.drain.end", {
      ...details,
      eventCount,
      needsCompaction,
      eventTypeKinds,
    })
  }

  static markStreamInterrupted(details: Details, reason: string): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.interrupted", { ...details, reason })
  }

  static markStreamCleanup(details: Details, pendingToolCalls: number, reasoningParts: number, hasCurrentText: boolean): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.cleanup", {
      ...details,
      pendingToolCalls,
      reasoningParts,
      hasCurrentText,
    })
  }

  /**
   * Tool-result handoff marks — never include tool input/output body.
   * Used to distinguish: execute ended without raw result, raw result lost in processor,
   * or processor received result but terminal persistence failed.
   */
  static markToolHandoff(input: {
    readonly sessionID: string
    readonly messageID: string
    readonly callID: string
    readonly tool?: string
    readonly eventType: string
    readonly phase: string
    readonly pendingToolCalls?: number
    readonly error?: string
  }): void {
    SidecarDiagnostics.mark("SessionProcessor.tool.handoff", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      tool: input.tool ?? null,
      eventType: input.eventType,
      phase: input.phase,
      pendingToolCalls: input.pendingToolCalls ?? null,
      error: input.error ?? null,
    })
  }

  static markToolHandoffUnmatched(input: {
    readonly sessionID: string
    readonly messageID: string
    readonly callID: string
    readonly tool?: string
    readonly eventType: string
    readonly pendingToolCalls?: number
  }): void {
    SidecarDiagnostics.mark("SessionProcessor.tool.handoff.unmatched", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
      tool: input.tool ?? null,
      eventType: input.eventType,
      pendingToolCalls: input.pendingToolCalls ?? null,
    })
  }

  static markStreamCleanupWait(details: Details, pendingToolCalls: number): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.cleanup.wait", {
      ...details,
      pendingToolCalls,
    })
  }

  static markStreamCleanupTimeout(details: Details, pendingToolCalls: number, timeoutMs: number): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.cleanup.timeout", {
      ...details,
      pendingToolCalls,
      timeoutMs,
    })
  }

  static markStreamCleanupEnd(details: Details, pendingToolCalls: number, timedOut: boolean): void {
    SidecarDiagnostics.mark("SessionProcessor.stream.cleanup.end", {
      ...details,
      pendingToolCalls,
      timedOut,
    })
  }

  static markLlmToolEvent(input: {
    readonly sessionID: string
    readonly messageID: string
    readonly runtime: "ai-sdk" | "native" | "normalized"
    readonly eventType: string
    readonly callID: string | null
    readonly tool?: string
  }): void {
    SidecarDiagnostics.mark("LLM.tool.event", {
      sessionID: input.sessionID,
      messageID: input.messageID,
      runtime: input.runtime,
      eventType: input.eventType,
      callID: input.callID,
      tool: input.tool ?? null,
    })
  }

  static eventType(event: LLMEvent): string {
    return llmEventType(event)
  }

  static shellDetails(input: ShellInput, ctx: ShellContext): Details {
    return {
      tool: "bash",
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID ?? null,
      shellLength: input.shell.length,
      commandLength: input.command.length,
      cwdLength: input.cwd.length,
      timeout: input.timeout,
    }
  }

  static markShellRunStart(details: Details): void {
    SidecarDiagnostics.mark("ShellTool.run.start", details)
    SessionDiagnostics.markToolPhase(details, "shell", { timeout: details.timeout ?? null })
  }

  static markShellSpawnStart(details: Details): void {
    SidecarDiagnostics.mark("ShellTool.process.spawn.start", details)
    SessionDiagnostics.markToolPhase(details, "shell.spawn")
  }

  static markShellSpawned(details: Details, pid: string): void {
    SidecarDiagnostics.mark("ShellTool.process.spawned", { ...details, pid })
    SessionDiagnostics.markToolPhase(details, "shell.running", { pid })
  }

  static markShellSpawnError(details: Details, error: unknown): void {
    SidecarDiagnostics.mark("ShellTool.process.spawn.error", { ...details, error: errorMessage(error) })
    SessionDiagnostics.markToolPhase(details, "shell.spawn.error", { error: errorMessage(error) })
  }

  static markShellExit(details: Details, kind: string, code: number | null): void {
    SidecarDiagnostics.mark("ShellTool.process.exit", { ...details, exitKind: kind, exitCode: code })
    SessionDiagnostics.markToolPhase(details, "shell.exit", { exitKind: kind, exitCode: code })
  }

  static markShellKillStart(details: Details, reason: string): void {
    SidecarDiagnostics.mark("ShellTool.process.kill.start", { ...details, reason })
  }

  static markShellKillEnd(details: Details, reason: string): void {
    SidecarDiagnostics.mark("ShellTool.process.kill.end", { ...details, reason })
  }

  static markShellKillError(details: Details, reason: string, error: unknown): void {
    SidecarDiagnostics.mark("ShellTool.process.kill.error", { ...details, reason, error: errorMessage(error) })
  }

  static markShellKillTreeStart(details: Details, reason: string, pid: number): void {
    SidecarDiagnostics.mark("ShellTool.process.kill.tree.start", { ...details, reason, pid })
  }

  static markShellKillTreeEnd(
    details: Details,
    reason: string,
    result: { readonly ok: boolean; readonly method: string; readonly error?: string },
  ): void {
    SidecarDiagnostics.mark("ShellTool.process.kill.tree.end", {
      ...details,
      reason,
      ok: result.ok,
      method: result.method,
      error: result.error ?? null,
    })
  }

  static markShellRunEnd(details: Details, output: ShellOutput): void {
    SidecarDiagnostics.mark("ShellTool.run.end", {
      ...details,
      exitCode: output.exit,
      aborted: output.aborted,
      expired: output.expired,
      truncated: output.truncated,
      savedToFile: output.savedToFile,
      outputLength: output.outputLength,
      previewLength: output.previewLength,
    })
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  return {}
}

function outputDetails(details: Details, output: ToolOutput): Details {
  return {
    ...details,
    outputLength: output.output?.length ?? 0,
    attachments: output.attachments?.length ?? 0,
    metadataKeys: output.metadata ? Object.keys(output.metadata).length : 0,
  }
}

function mcpResultDetails(details: Details, result: McpResult): Details {
  const summary = { textLength: 0, imageCount: 0, resourceCount: 0, resourceBlobBytes: 0 }
  for (const item of result.content) {
    const itemRecord = toRecord(item)
    if (itemRecord.type === "text" && typeof itemRecord.text === "string") summary.textLength += itemRecord.text.length
    if (itemRecord.type === "image") summary.imageCount += 1
    if (itemRecord.type === "resource") {
      const resource = toRecord(itemRecord.resource)
      summary.resourceCount += 1
      if (typeof resource.blob === "string") summary.resourceBlobBytes += base64Size(resource.blob)
      if (typeof resource.text === "string") summary.textLength += resource.text.length
    }
  }
  return {
    ...details,
    contentItems: result.content.length,
    textLength: summary.textLength,
    imageCount: summary.imageCount,
    resourceCount: summary.resourceCount,
    resourceBlobBytes: summary.resourceBlobBytes,
    metadataKeys: result.metadata ? Object.keys(result.metadata).length : 0,
  }
}

function stringFieldLength(record: Record<string, unknown>, key: (typeof STRING_DETAIL_FIELDS)[number]): number | null {
  const value = record[key]
  return typeof value === "string" ? value.length : null
}

function llmEventType(event: LLMEvent): string {
  return typeof event.type === "string" ? event.type : "unknown"
}

export function base64Size(value: string): number {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

export * as SidecarSessionDiagnostics from "./session"
