/**
 * Unified context window occupancy helpers.
 *
 * Shared across opencode native, OMO plugin, and DCP plugin to ensure
 * consistent "current context usage" computation everywhere.
 *
 * Formula: input + output + reasoning + cache.read + cache.write
 * - `input` = non-cached input tokens (fresh prompt portion)
 * - `output` = visible output tokens (excluding reasoning)
 * - `reasoning` = hidden reasoning tokens (sent as context to next turn)
 * - `cache.read` = prompt cache read tokens
 * - `cache.write` = prompt cache write tokens
 *
 * We deliberately include reasoning because opencode replays reasoning parts
 * as context in subsequent turns (see message-v2.ts toModelMessagesEffect).
 *
 * We do NOT use `tokens.total` because providers compute it differently
 * and some omit reasoning or cache from their total.
 */

export const DEFAULT_CONTEXT_LIMIT = 200000

/**
 * Compute current context-window occupancy from an assistant message's token fields.
 *
 * Matches the formula used by:
 * - opencode overflow.ts (isOverflow)
 * - opencode ACP usage.ts (used)
 * - OMO preemptive-compaction-trigger.ts (totalInputTokens)
 * - OMO context-window-usage.ts (usedTokens)
 * - DCP token-utils.ts (getCurrentTokenUsage)
 * - GUI session-context-metrics.ts (tokenTotal)
 */
export function getCurrentContextTokens(tokens: {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}): number {
  return (
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (tokens.cache?.read ?? 0) +
    (tokens.cache?.write ?? 0)
  )
}

/**
 * Compute context usage percentage (0-100).
 * Returns 0 when limit is 0 to avoid division by zero.
 */
export function getContextUsagePercent(tokens: {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}, limit: number): number {
  if (limit <= 0) return 0
  return Math.round((getCurrentContextTokens(tokens) / limit) * 100)
}
