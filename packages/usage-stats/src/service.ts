import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Context, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"
import { projectLabel, projectPathHint } from "./project-label"

export interface RecordStepInput {
  readonly sessionID: string
  readonly providerID: string
  readonly modelID: string
  readonly tokensIn: number
  readonly tokensOut: number
  readonly tokensReasoning: number
  readonly tokensCacheRead: number
  readonly tokensCacheWrite: number
}

export const recordStep = (input: RecordStepInput) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const session = yield* db.get<{ project_id: string }>(
      sql`SELECT project_id FROM "session" WHERE id = ${input.sessionID}`,
    )
    if (!session) return

    const modelId = `${input.providerID}:${input.modelID}`
    const date = todayStr()

    yield* db.run(sql`
      INSERT INTO "daily_usage" ("date", "project_id", "model_id", "call_count", "tokens_in", "tokens_out", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write")
      VALUES (${date}, ${session.project_id}, ${modelId}, 1, ${input.tokensIn}, ${input.tokensOut}, ${input.tokensReasoning}, ${input.tokensCacheRead}, ${input.tokensCacheWrite})
      ON CONFLICT("date", "project_id", "model_id") DO UPDATE SET
        "call_count" = "call_count" + 1,
        "tokens_in" = "tokens_in" + ${input.tokensIn},
        "tokens_out" = "tokens_out" + ${input.tokensOut},
        "tokens_reasoning" = "tokens_reasoning" + ${input.tokensReasoning},
        "tokens_cache_read" = "tokens_cache_read" + ${input.tokensCacheRead},
        "tokens_cache_write" = "tokens_cache_write" + ${input.tokensCacheWrite}
    `)
  })

export const QueryResult = Schema.Struct({
  date: Schema.String,
  project_id: Schema.String,
  /** Display label (directory basename preferred). */
  project_worktree: Schema.String,
  /** Full path hint for tooltip. */
  project_path: Schema.optional(Schema.String),
  model_id: Schema.String,
  call_count: Schema.Number,
  tokens_in: Schema.Number,
  tokens_out: Schema.Number,
  tokens_reasoning: Schema.Number,
  tokens_cache_read: Schema.Number,
  tokens_cache_write: Schema.Number,
}).annotate({ identifier: "UsageStatsQueryResult" })

export type QueryResult = Schema.Schema.Type<typeof QueryResult>

export const QueryDailyResult = Schema.Struct({
  date: Schema.String,
  call_count: Schema.Number,
  tokens_in: Schema.Number,
  tokens_out: Schema.Number,
  tokens_reasoning: Schema.Number,
  tokens_cache_read: Schema.Number,
  tokens_cache_write: Schema.Number,
}).annotate({ identifier: "UsageStatsQueryDailyResult" })
export type QueryDailyResult = Schema.Schema.Type<typeof QueryDailyResult>

export interface Interface {
  readonly queryByDate: (date: string) => Effect.Effect<readonly QueryResult[], any, any>
  readonly queryByRange: (range: number) => Effect.Effect<readonly QueryResult[], any, any>
  readonly queryDailyByRange: (range: number) => Effect.Effect<readonly QueryDailyResult[], any, any>
  readonly cleanup: (keepDays: number) => Effect.Effect<number, any, any>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UsageStats") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const queryByDate: Interface["queryByDate"] = (date) =>
      Effect.gen(function* () {
        const rows = yield* db.all<Record<string, unknown>>(
          sql`SELECT du.*,
                     p.worktree AS project_worktree,
                     p.name AS project_name,
                     (
                       SELECT s.directory FROM "session" s
                       WHERE s.project_id = du.project_id
                       ORDER BY s.time_updated DESC
                       LIMIT 1
                     ) AS session_directory,
                     (
                       SELECT pd.directory FROM "project_directory" pd
                       WHERE pd.project_id = du.project_id
                       ORDER BY pd.time_created DESC
                       LIMIT 1
                     ) AS project_directory
              FROM "daily_usage" du
              LEFT JOIN "project" p ON du.project_id = p.id
              WHERE du."date" = ${date}
              ORDER BY du."call_count" DESC`,
        )
        return rows.map(mapRow)
      })

    const queryByRange: Interface["queryByRange"] = (range) =>
      Effect.gen(function* () {
        const start = new Date(Date.now() - range * 86_400_000).toLocaleDateString("en-CA")
        const end = todayStr()
        const rows = yield* db.all<Record<string, unknown>>(
          sql`SELECT du.project_id, du.model_id,
                     p.worktree AS project_worktree,
                     p.name AS project_name,
                     (
                       SELECT s.directory FROM "session" s
                       WHERE s.project_id = du.project_id
                       ORDER BY s.time_updated DESC
                       LIMIT 1
                     ) AS session_directory,
                     (
                       SELECT pd.directory FROM "project_directory" pd
                       WHERE pd.project_id = du.project_id
                       ORDER BY pd.time_created DESC
                       LIMIT 1
                     ) AS project_directory,
                     SUM(du.call_count) AS call_count,
                     SUM(du.tokens_in) AS tokens_in,
                     SUM(du.tokens_out) AS tokens_out,
                     SUM(du.tokens_reasoning) AS tokens_reasoning,
                     SUM(du.tokens_cache_read) AS tokens_cache_read,
                     SUM(du.tokens_cache_write) AS tokens_cache_write
              FROM "daily_usage" du
              LEFT JOIN "project" p ON du.project_id = p.id
              WHERE du."date" >= ${start} AND du."date" <= ${end}
              GROUP BY du.project_id, du.model_id
              ORDER BY SUM(du.call_count) DESC`,
        )
        return rows.map(mapRow)
      })

    const queryDailyByRange: Interface["queryDailyByRange"] = (range) =>
      Effect.gen(function* () {
        const start = new Date(Date.now() - range * 86_400_000).toLocaleDateString("en-CA")
        const end = todayStr()
        const rows = yield* db.all<Record<string, unknown>>(
          sql`SELECT du.date,
                     SUM(du.call_count) AS call_count,
                     SUM(du.tokens_in) AS tokens_in,
                     SUM(du.tokens_out) AS tokens_out,
                     SUM(du.tokens_reasoning) AS tokens_reasoning,
                     SUM(du.tokens_cache_read) AS tokens_cache_read,
                     SUM(du.tokens_cache_write) AS tokens_cache_write
              FROM "daily_usage" du
              WHERE du."date" >= ${start} AND du."date" <= ${end}
              GROUP BY du.date
              ORDER BY du.date DESC`,
        )
        return rows.map(mapDailyRow)
      })

    const cleanup: Interface["cleanup"] = (keepDays) =>
      Effect.gen(function* () {
        const cutoff = new Date(Date.now() - keepDays * 86_400_000).toLocaleDateString("en-CA")
        const result = yield* db.run(sql`DELETE FROM "daily_usage" WHERE "date" <= ${cutoff}`)
        return (result as { changes?: number }).changes ?? 0
      })

    return Service.of({ queryByDate, queryByRange, queryDailyByRange, cleanup })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node] })

function todayStr(): string {
  return new Date().toLocaleDateString("en-CA")
}

function mapRow(row: Record<string, unknown>): QueryResult {
  const project_id = String(row.project_id ?? "")
  // Prefer session directory, then project_directory table, then project.worktree (|| skips empty string).
  const directory = String(row.session_directory || row.project_directory || "")
  const worktree = String(row.project_worktree || "")
  const project_name = String(row.project_name || "")
  const label = projectLabel({
    directory,
    project_worktree: worktree,
    project_name,
    project_id,
  })
  const pathHint = projectPathHint({ directory, project_worktree: worktree })
  return {
    date: String(row.date ?? ""),
    project_id,
    // UI sorts/displays this field; put the resolved label so blanks disappear.
    project_worktree: label,
    project_path: pathHint || label,
    model_id: String(row.model_id ?? ""),
    call_count: Number(row.call_count ?? 0),
    tokens_in: Number(row.tokens_in ?? 0),
    tokens_out: Number(row.tokens_out ?? 0),
    tokens_reasoning: Number(row.tokens_reasoning ?? 0),
    tokens_cache_read: Number(row.tokens_cache_read ?? 0),
    tokens_cache_write: Number(row.tokens_cache_write ?? 0),
  }
}

function mapDailyRow(row: Record<string, unknown>): QueryDailyResult {
  return {
    date: String(row.date ?? ""),
    call_count: Number(row.call_count ?? 0),
    tokens_in: Number(row.tokens_in ?? 0),
    tokens_out: Number(row.tokens_out ?? 0),
    tokens_reasoning: Number(row.tokens_reasoning ?? 0),
    tokens_cache_read: Number(row.tokens_cache_read ?? 0),
    tokens_cache_write: Number(row.tokens_cache_write ?? 0),
  }
}
