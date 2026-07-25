import { describe, expect, test } from "bun:test"
import { EMPTY_PROJECT_KEY, type SessionRow } from "./types"
import {
  filterByProject,
  listProjects,
  pageSessions,
  prepareTable,
  projectKey,
  sortSessions,
} from "./table-view"

function row(partial: Partial<SessionRow> & Pick<SessionRow, "id">): SessionRow {
  return {
    id: partial.id,
    project_id: partial.project_id ?? "p1",
    project_name: partial.project_name ?? "",
    project_worktree: partial.project_worktree ?? "/a/p1",
    title: partial.title ?? partial.id,
    directory: partial.directory ?? "/a/p1",
    parent_id: partial.parent_id ?? null,
    time_created: partial.time_created ?? 1,
    time_updated: partial.time_updated ?? 1,
    time_archived: partial.time_archived ?? null,
    protected: partial.protected ?? false,
    message_count: partial.message_count ?? 0,
    approx_bytes: partial.approx_bytes ?? 0,
  }
}

describe("projectKey", () => {
  test("uses EMPTY_PROJECT_KEY when project_id empty", () => {
    // given
    const empty = row({ id: "s1", project_id: "" })
    // when / then
    expect(projectKey(empty)).toBe(EMPTY_PROJECT_KEY)
  })
})

describe("listProjects", () => {
  test("dedupes and labels empty project", () => {
    // given — projectLabel prefers directory leaf over worktree
    const rows = [
      row({ id: "a", project_id: "p1", project_worktree: "/x/other", directory: "/x/foo" }),
      row({ id: "b", project_id: "p1", project_worktree: "/x/other", directory: "/x/foo" }),
      row({ id: "c", project_id: "", project_worktree: "", directory: "" }),
    ]
    // when
    const projects = listProjects(rows)
    // then
    expect(projects).toEqual([
      { id: EMPTY_PROJECT_KEY, label: "（无项目）" },
      { id: "p1", label: "foo" },
    ])
  })

  test("root worktree falls back to directory leaf", () => {
    // given
    const rows = [row({ id: "a", project_id: "root", project_worktree: "/", directory: "E:/works/opencode" })]
    // when
    const projects = listProjects(rows)
    // then
    expect(projects).toEqual([{ id: "root", label: "opencode" }])
  })
})

describe("filterByProject", () => {
  test("filters by project key including empty", () => {
    // given
    const rows = [
      row({ id: "a", project_id: "p1" }),
      row({ id: "b", project_id: "" }),
    ]
    // when / then
    expect(filterByProject(rows, "").map((r) => r.id)).toEqual(["a", "b"])
    expect(filterByProject(rows, "p1").map((r) => r.id)).toEqual(["a"])
    expect(filterByProject(rows, EMPTY_PROJECT_KEY).map((r) => r.id)).toEqual(["b"])
  })
})

describe("sortSessions", () => {
  test("sorts by approx_bytes desc then id", () => {
    // given
    const rows = [
      row({ id: "a", approx_bytes: 10 }),
      row({ id: "b", approx_bytes: 30 }),
      row({ id: "c", approx_bytes: 20 }),
    ]
    // when
    const sorted = sortSessions(rows, "approx_bytes", "desc")
    // then
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"])
  })
})

describe("pageSessions", () => {
  test("pages and clamps page index", () => {
    // given
    const rows = [row({ id: "1" }), row({ id: "2" }), row({ id: "3" })]
    // when
    const page1 = pageSessions(rows, 1, 2)
    const page3 = pageSessions(rows, 9, 2)
    // then
    expect(page1.rows.map((r) => r.id)).toEqual(["1", "2"])
    expect(page1.pageCount).toBe(2)
    expect(page3.page).toBe(2)
    expect(page3.rows.map((r) => r.id)).toEqual(["3"])
  })
})

describe("prepareTable", () => {
  test("filters then sorts then pages", () => {
    // given
    const sessions = [
      row({ id: "a", project_id: "p1", approx_bytes: 1, time_updated: 1 }),
      row({ id: "b", project_id: "p2", approx_bytes: 9, time_updated: 9 }),
      row({ id: "c", project_id: "p1", approx_bytes: 5, time_updated: 5 }),
    ]
    // when
    const result = prepareTable({
      sessions,
      projectID: "p1",
      sortKey: "approx_bytes",
      sortDir: "desc",
      page: 1,
      pageSize: 10,
    })
    // then
    expect(result.filtered.map((r) => r.id)).toEqual(["a", "c"])
    expect(result.rows.map((r) => r.id)).toEqual(["c", "a"])
    expect(result.projects.map((p) => p.id).sort()).toEqual(["p1", "p2"])
  })
})
