import { EMPTY_PROJECT_KEY, projectLabel, type SessionRow } from "./types"

export type SortKey =
  | "project_worktree"
  | "title"
  | "message_count"
  | "approx_bytes"
  | "time_updated"
  | "protected"

export type SortDir = "asc" | "desc"

export type ProjectOption = {
  readonly id: string
  readonly label: string
}

export function projectKey(row: Pick<SessionRow, "project_id">): string {
  return row.project_id || EMPTY_PROJECT_KEY
}

export function listProjects(rows: readonly SessionRow[]): ProjectOption[] {
  const map = new Map<string, string>()
  for (const row of rows) {
    const id = projectKey(row)
    if (map.has(id)) continue
    map.set(id, projectLabel(row))
  }
  return [...map.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function filterByProject(rows: readonly SessionRow[], projectID: string): SessionRow[] {
  if (!projectID) return [...rows]
  return rows.filter((row) => projectKey(row) === projectID)
}

function cmp(a: string | number | boolean, b: string | number | boolean): number {
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b)
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function sortValue(row: SessionRow, key: SortKey): string | number | boolean {
  switch (key) {
    case "project_worktree":
      return projectLabel(row)
    case "title":
      return row.title
    case "message_count":
      return row.message_count
    case "approx_bytes":
      return row.approx_bytes
    case "time_updated":
      return row.time_updated
    case "protected":
      return row.protected
  }
}

export function sortSessions(
  rows: readonly SessionRow[],
  key: SortKey,
  dir: SortDir,
): SessionRow[] {
  const sign = dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const primary = cmp(sortValue(a, key), sortValue(b, key)) * sign
    if (primary !== 0) return primary
    return cmp(a.id, b.id)
  })
}

export function pageSessions(
  rows: readonly SessionRow[],
  page: number,
  pageSize: number,
): { readonly rows: SessionRow[]; readonly page: number; readonly pageCount: number } {
  const size = Math.max(1, Math.floor(pageSize))
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const safePage = Math.min(Math.max(1, Math.floor(page)), pageCount)
  const start = (safePage - 1) * size
  return {
    rows: rows.slice(start, start + size),
    page: safePage,
    pageCount,
  }
}

export function prepareTable(input: {
  readonly sessions: readonly SessionRow[]
  readonly projectID: string
  readonly sortKey: SortKey
  readonly sortDir: SortDir
  readonly page: number
  readonly pageSize: number
}) {
  const filtered = filterByProject(input.sessions, input.projectID)
  const sorted = sortSessions(filtered, input.sortKey, input.sortDir)
  const paged = pageSessions(sorted, input.page, input.pageSize)
  return {
    projects: listProjects(input.sessions),
    filtered,
    sorted,
    ...paged,
  }
}
