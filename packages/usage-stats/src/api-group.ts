import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const QueryResult = Schema.Struct({
  date: Schema.String,
  project_id: Schema.String,
  /** Resolved display label (directory basename preferred). */
  project_worktree: Schema.String,
  /** Full path for tooltip when available. */
  project_path: Schema.optional(Schema.String),
  model_id: Schema.String,
  call_count: Schema.Number,
  tokens_in: Schema.Number,
  tokens_out: Schema.Number,
  tokens_reasoning: Schema.Number,
  tokens_cache_read: Schema.Number,
  tokens_cache_write: Schema.Number,
}).annotate({ identifier: "UsageStatsQueryResult" })

const QueryDailyResult = Schema.Struct({
  date: Schema.String,
  call_count: Schema.Number,
  tokens_in: Schema.Number,
  tokens_out: Schema.Number,
  tokens_reasoning: Schema.Number,
  tokens_cache_read: Schema.Number,
  tokens_cache_write: Schema.Number,
}).annotate({ identifier: "UsageStatsQueryDailyResult" })

export const UsageStatsPaths = {
  daily: "/usage-stats/daily",
  range: "/usage-stats/range",
  dailyRange: "/usage-stats/daily-range",
  cleanup: "/usage-stats/cleanup",
} as const

export const UsageStatsApi = HttpApi.make("usage-stats")
  .add(
    HttpApiGroup.make("usage-stats")
      .add(
        HttpApiEndpoint.get("daily", UsageStatsPaths.daily, {
          query: Schema.Struct({ date: Schema.String }),
          success: Schema.Array(QueryResult),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "usage-stats.daily.get",
            summary: "Get daily usage statistics",
            description: "Returns per-model token usage for a given date, aggregated by project and model.",
          }),
        ),
        HttpApiEndpoint.get("range", UsageStatsPaths.range, {
          query: Schema.Struct({ range: Schema.Number }),
          success: Schema.Array(QueryResult),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "usage-stats.range.get",
            summary: "Get usage statistics over a date range",
            description: "Returns per-model token usage aggregated over the last N days.",
          }),
        ),
        HttpApiEndpoint.get("dailyRange", UsageStatsPaths.dailyRange, {
          query: Schema.Struct({ range: Schema.Number }),
          success: Schema.Array(QueryDailyResult),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "usage-stats.daily-range.get",
            summary: "Get daily usage breakdown over a date range",
            description: "Returns per-day token usage aggregated across all projects and models.",
          }),
        ),
        HttpApiEndpoint.post("cleanup", UsageStatsPaths.cleanup, {
          payload: Schema.Struct({ keep_days: Schema.Number }),
          success: Schema.Struct({ deleted: Schema.Number }),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "usage-stats.cleanup.post",
            summary: "Cleanup old usage records",
            description: "Delete usage records older than the specified number of days.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "usage-stats",
          description: "Daily model usage statistics.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode usage-stats HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for usage statistics.",
    }),
  )
