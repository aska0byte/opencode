import type { AssistantMessage, Message, Session } from "@opencode-ai/sdk/v2/client"

const DEFAULT_CONTEXT_LIMIT = 200000

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number
  input: number
  usedTokens: number
  usage: number
}

/** Unified context-window occupancy: input + output + reasoning + cache.read + cache.write */
const contextTokens = (msg: AssistantMessage) =>
  (msg.tokens.input ?? 0) +
  (msg.tokens.output ?? 0) +
  (msg.tokens.reasoning ?? 0) +
  (msg.tokens.cache?.read ?? 0) +
  (msg.tokens.cache?.write ?? 0)

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (contextTokens(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Context | undefined => {
  const message = lastAssistantWithTokens(messages)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context ?? DEFAULT_CONTEXT_LIMIT
  const usedTokens = contextTokens(message)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: message.tokens.input,
    usedTokens,
    usage: limit > 0 ? Math.round((usedTokens / limit) * 100) : 0,
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}

export function getSessionTokenTotal(tokens: Session["tokens"] | undefined) {
  if (!tokens) return undefined
  return tokens.input + tokens.output + tokens.reasoning + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
}
