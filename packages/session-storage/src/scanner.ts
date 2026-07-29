import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql, type SQL } from "drizzle-orm"
import {
  clampScanLimit,
  isProtected,
  type ScanFilter,
  type ScanResult,
  type SessionRow,
} from "./types"

type RawRow = {
  id: string
  project_id: string
  project_name: string | null
  project_worktree: string | null
  title: string
  directory: string
  parent_id: string | null
  time_created: number
  time_updated: number
  time_archived: number | null
  metadata: string | Record<string, unknown> | null
  message_count: number
  approx_bytes: number
  bytes_message: number | null
  bytes_part: number | null
  bytes_event: number | null
  child_session_count: number | null
}

/** Correlated recursive CTE over outer alias `s`. */
const BYTES_MESSAGE = sql.raw(`(
  WITH RECURSIVE tree(id) AS (
    SELECT s.id
    UNION ALL
    SELECT c.id FROM "session" c INNER JOIN tree t ON c.parent_id = t.id
  )
  SELECT COALESCE(SUM(LENGTH(m.data)), 0) FROM "message" m WHERE m.session_id IN (SELECT id FROM tree)
)`)
const BYTES_PART = sql.raw(`(
  WITH RECURSIVE tree(id) AS (
    SELECT s.id
    UNION ALL
    SELECT c.id FROM "session" c INNER JOIN tree t ON c.parent_id = t.id
  )
  SELECT COALESCE(SUM(LENGTH(pt.data)), 0) FROM "part" pt WHERE pt.session_id IN (SELECT id FROM tree)
)`)
// Event log keys sessions via aggregate_id (not session_id).
const BYTES_EVENT = sql.raw(`(
  WITH RECURSIVE tree(id) AS (
    SELECT s.id
    UNION ALL
    SELECT c.id FROM "session" c INNER JOIN tree t ON c.parent_id = t.id
  )
  SELECT COALESCE(SUM(LENGTH(e.data)), 0) FROM "event" e WHERE e.aggregate_id IN (SELECT id FROM tree)
)`)
const CHILD_COUNT = sql.raw(`(
  WITH RECURSIVE tree(id) AS (
    SELECT s.id
    UNION ALL
    SELECT c.id FROM "session" c INNER JOIN tree t ON c.parent_id = t.id
  )
  SELECT COUNT(*) - 1 FROM tree
)`)

function parseMetadata(value: RawRow["metadata"]): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === "object") return value
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function mapRow(row: RawRow): SessionRow {
  const metadata = parseMetadata(row.metadata)
  const bm = Number(row.bytes_message ?? 0)
  const bp = Number(row.bytes_part ?? 0)
  const be = Number(row.bytes_event ?? 0)
  return {
    id: String(row.id),
    project_id: String(row.project_id ?? ""),
    project_name: String(row.project_name ?? ""),
    project_worktree: String(row.project_worktree ?? ""),
    title: String(row.title ?? ""),
    directory: String(row.directory ?? ""),
    parent_id: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    time_created: Number(row.time_created ?? 0),
    time_updated: Number(row.time_updated ?? 0),
    time_archived: row.time_archived === null || row.time_archived === undefined ? null : Number(row.time_archived),
    protected: isProtected(metadata),
    message_count: Number(row.message_count ?? 0),
    approx_bytes: Number(row.approx_bytes ?? bm + bp + be),
    breakdown: { message: bm, part: bp, event: be },
    child_session_count: Number(row.child_session_count ?? 0),
  }
}

function whereClauses(filter?: ScanFilter): SQL[] {
  const clauses: SQL[] = [sql`s.parent_id IS NULL`]
  if (filter?.projectID) clauses.push(sql`s.project_id = ${filter.projectID}`)
  if (filter?.olderThan !== undefined) clauses.push(sql`s.time_updated < ${filter.olderThan}`)
  return clauses
}

export function scan(filter?: ScanFilter): Effect.Effect<ScanResult, never, Database.Service> {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const limit = clampScanLimit(filter?.limit)
    const where = sql.join(whereClauses(filter), sql` AND `)

    const countRows = yield* db.all<{ n: number }>(sql`
      SELECT COUNT(*) AS n
      FROM "session" s
      WHERE ${where}
    `)
    const totalMatched = Number(countRows[0]?.n ?? 0)

    const rows = yield* db.all<RawRow>(sql`
      SELECT
        s.id,
        s.project_id,
        p.name AS project_name,
        p.worktree AS project_worktree,
        s.title,
        s.directory,
        s.parent_id,
        s.time_created,
        s.time_updated,
        s.time_archived,
        s.metadata,
        (
          SELECT COUNT(*) FROM "message" m WHERE m.session_id = s.id
        ) AS message_count,
        ${BYTES_MESSAGE} AS bytes_message,
        ${BYTES_PART} AS bytes_part,
        ${BYTES_EVENT} AS bytes_event,
        (${BYTES_MESSAGE}) + (${BYTES_PART}) + (${BYTES_EVENT}) AS approx_bytes,
        ${CHILD_COUNT} AS child_session_count
      FROM "session" s
      LEFT JOIN "project" p ON s.project_id = p.id
      WHERE ${where}
      ORDER BY s.time_updated DESC
      LIMIT ${limit}
    `)

    const minBytes = filter?.minBytes
    const sessions = rows
      .map(mapRow)
      .filter((row) => (minBytes === undefined ? true : row.approx_bytes >= minBytes))

    return {
      sessions,
      session_count: sessions.length,
      total_approx_bytes: sessions.reduce((sum, row) => sum + row.approx_bytes, 0),
      total_matched: totalMatched,
      truncated: totalMatched > limit,
      limit,
    }
  }).pipe(Effect.orDie)
}

export function resolveTargets(input: {
  sessionIDs?: readonly string[]
  filter?: ScanFilter
}): Effect.Effect<readonly SessionRow[], never, Database.Service> {
  return Effect.gen(function* () {
    if (input.sessionIDs && input.sessionIDs.length > 0) {
      const { db } = yield* Database.Service
      const ids = input.sessionIDs
      const rows = yield* db.all<RawRow>(sql`
        SELECT
          s.id,
          s.project_id,
          p.name AS project_name,
          p.worktree AS project_worktree,
          s.title,
          s.directory,
          s.parent_id,
          s.time_created,
          s.time_updated,
          s.time_archived,
          s.metadata,
          (
            SELECT COUNT(*) FROM "message" m WHERE m.session_id = s.id
          ) AS message_count,
          ${BYTES_MESSAGE} AS bytes_message,
          ${BYTES_PART} AS bytes_part,
          ${BYTES_EVENT} AS bytes_event,
          (${BYTES_MESSAGE}) + (${BYTES_PART}) + (${BYTES_EVENT}) AS approx_bytes,
          ${CHILD_COUNT} AS child_session_count
        FROM "session" s
        LEFT JOIN "project" p ON s.project_id = p.id
        WHERE s.id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
      `)
      const wanted = new Set(ids)
      return rows.map(mapRow).filter((row) => wanted.has(row.id))
    }
    const result = yield* scan(input.filter)
    return result.sessions
  }).pipe(Effect.orDie)
}
