import { Schema } from "effect"

export const PROTECTED_KEY = "protected" as const
export const DEFAULT_SCAN_LIMIT = 1000
export const MAX_SCAN_LIMIT = 10_000
export const EMPTY_PROJECT_KEY = "__empty__" as const

export const BatchAction = Schema.Literals(["protect", "unprotect", "delete", "vacuum"])
export type BatchAction = Schema.Schema.Type<typeof BatchAction>

export const ScanFilter = Schema.Struct({
  projectID: Schema.optional(Schema.String),
  olderThan: Schema.optional(Schema.Number),
  minBytes: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
}).annotate({ identifier: "SessionStorageScanFilter" })
export type ScanFilter = Schema.Schema.Type<typeof ScanFilter>

/** Approx size breakdown for a session tree (bytes of JSON column lengths). */
export const BytesBreakdown = Schema.Struct({
  message: Schema.Number,
  part: Schema.Number,
  event: Schema.Number,
}).annotate({ identifier: "SessionStorageBytesBreakdown" })
export type BytesBreakdown = Schema.Schema.Type<typeof BytesBreakdown>

export const SessionRow = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  project_name: Schema.String,
  project_worktree: Schema.String,
  title: Schema.String,
  directory: Schema.String,
  parent_id: Schema.NullOr(Schema.String),
  time_created: Schema.Number,
  time_updated: Schema.Number,
  time_archived: Schema.NullOr(Schema.Number),
  protected: Schema.Boolean,
  message_count: Schema.Number,
  /** Subtree estimate: message+part+event for this root and all descendants. */
  approx_bytes: Schema.Number,
  breakdown: Schema.optional(BytesBreakdown),
  child_session_count: Schema.optional(Schema.Number),
}).annotate({ identifier: "SessionStorageSessionRow" })
export type SessionRow = Schema.Schema.Type<typeof SessionRow>

/**
 * Why a batch item was not deleted / not applied.
 * - protected: this session is protected
 * - has_protected_descendants: unprotected but still has protected children after purge of siblings
 * - not_found: session missing
 * - error: Session.remove / setMetadata failed (must NOT report as applied)
 */
export const SkipReason = Schema.Literals([
  "protected",
  "has_protected_descendants",
  "not_found",
  "error",
])
export type SkipReason = Schema.Schema.Type<typeof SkipReason>

export type DeleteOutcome =
  | { readonly id: string; readonly ok: true }
  | { readonly id: string; readonly ok: false; readonly reason: SkipReason; readonly message?: string }

export type ProtectOutcome =
  | { readonly id: string; readonly ok: true }
  | { readonly id: string; readonly ok: false; readonly reason: SkipReason; readonly message?: string }

/** Last non-empty path segment; empty for root-ish paths like `/` or `C:/`. */
export function pathLeaf(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean)
  if (parts.length === 0) return ""
  const last = parts[parts.length - 1] ?? ""
  if (parts.length === 1 && /^[A-Za-z]:$/.test(last)) return ""
  return last
}

export function isRootPath(path: string): boolean {
  const n = path.replace(/\\/g, "/").trim()
  if (!n || n === "/") return true
  return /^[A-Za-z]:\/?$/.test(n)
}

/**
 * Human label for the "project" column: always the session working-directory basename.
 * Git / non-git both use `directory` (last path segment). Fallbacks only when empty.
 */
export function projectLabel(row: {
  readonly project_name?: string
  readonly project_worktree: string
  readonly directory: string
  readonly project_id: string
}): string {
  const dirLeaf = pathLeaf(row.directory)
  if (dirLeaf) return dirLeaf
  if (row.project_worktree && !isRootPath(row.project_worktree)) {
    const leaf = pathLeaf(row.project_worktree)
    if (leaf) return leaf
  }
  const name = row.project_name?.trim()
  if (name) return name
  if (row.project_id) return row.project_id.slice(0, 12)
  return "（无项目）"
}

export const SideBytes = Schema.Struct({
  tool_output: Schema.optional(Schema.Number),
  snapshot: Schema.optional(Schema.Number),
  storage: Schema.optional(Schema.Number),
}).annotate({ identifier: "SessionStorageSideBytes" })
export type SideBytes = Schema.Schema.Type<typeof SideBytes>

export const StorageState = Schema.Struct({
  idle: Schema.Boolean,
  active_session_count: Schema.Number,
  db_path: Schema.String,
  db_bytes: Schema.Number,
  /** SQLite freelist size when available; null if query fails. */
  freelist_bytes: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Sidecar dirs under data path; null/omitted fields when unreadable. */
  side_bytes: Schema.optional(Schema.NullOr(SideBytes)),
}).annotate({ identifier: "SessionStorageState" })
export type StorageState = Schema.Schema.Type<typeof StorageState>

export const ScanResult = Schema.Struct({
  sessions: Schema.Array(SessionRow),
  session_count: Schema.Number,
  total_approx_bytes: Schema.Number,
  total_matched: Schema.Number,
  truncated: Schema.Boolean,
  limit: Schema.Number,
}).annotate({ identifier: "SessionStorageScanResult" })
export type ScanResult = Schema.Schema.Type<typeof ScanResult>

export const BatchRequest = Schema.Struct({
  action: BatchAction,
  preview: Schema.optional(Schema.Boolean),
  sessionIDs: Schema.optional(Schema.Array(Schema.String)),
  filter: Schema.optional(ScanFilter),
}).annotate({ identifier: "SessionStorageBatchRequest" })
export type BatchRequest = Schema.Schema.Type<typeof BatchRequest>

export const BatchItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  approx_bytes: Schema.Number,
  skipped: Schema.optional(Schema.Boolean),
  skip_reason: Schema.optional(SkipReason),
  /** Extra detail when skip_reason is error. */
  error_message: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionStorageBatchItem" })
export type BatchItem = Schema.Schema.Type<typeof BatchItem>

export const BatchResult = Schema.Struct({
  action: BatchAction,
  preview: Schema.Boolean,
  applied: Schema.Number,
  skipped: Schema.Number,
  approx_bytes: Schema.Number,
  items: Schema.Array(BatchItem),
  db_bytes_before: Schema.optional(Schema.Number),
  db_bytes_after: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionStorageBatchResult" })
export type BatchResult = Schema.Schema.Type<typeof BatchResult>

export function isProtected(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.[PROTECTED_KEY] === true
}

export function clampScanLimit(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_SCAN_LIMIT
  const n = Math.floor(raw)
  if (n < 1) return 1
  if (n > MAX_SCAN_LIMIT) return MAX_SCAN_LIMIT
  return n
}
