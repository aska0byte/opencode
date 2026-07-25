import { describe, expect, test } from "bun:test"
import {
  createLatestPreferencePusher,
  mergeOpenedProjects,
  mergeOpenedProjectsRemoteFirst,
  normalizeOpenedProjects,
  openedProjectsEqual,
  resolveOpenedProjectsFromRemote,
} from "./server-api-storage"

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("createLatestPreferencePusher", () => {
  test("coalesces rapid updates into a single latest PUT per key", async () => {
    const started: Array<{ key: string; value: string }> = []
    let resolveFirst!: () => void
    const firstDone = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })

    let calls = 0
    const push: PreferencePush = async (_url, key, value) => {
      calls += 1
      started.push({ key, value })
      // Hold only the first write so intermediate updates can coalesce while in flight.
      if (calls === 1) await firstDone
    }

    const pusher = createLatestPreferencePusher(push)
    pusher.push("http://server", "opened_projects", "[{a}]")
    pusher.push("http://server", "opened_projects", "[{b},{a}]")
    pusher.push("http://server", "opened_projects", "[{c},{b},{a}]")

    // First write is in flight with the first snapshot; later values stay pending.
    expect(started).toEqual([{ key: "opened_projects", value: "[{a}]" }])
    expect(pusher.isBusy("opened_projects")).toBe(true)

    resolveFirst()
    await pusher.whenIdle()

    // Only the latest pending snapshot is sent after the first finishes — not every intermediate.
    expect(started).toEqual([
      { key: "opened_projects", value: "[{a}]" },
      { key: "opened_projects", value: "[{c},{b},{a}]" },
    ])
    expect(pusher.isBusy()).toBe(false)
  })

  test("keeps keys independent so last_project is not blocked forever by projects", async () => {
    const values: string[] = []
    const gate = deferred()
    const push: PreferencePush = async (_url, key, value) => {
      values.push(`${key}:${value}`)
      if (key === "opened_projects") await gate.promise
    }

    const pusher = createLatestPreferencePusher(push)
    pusher.push("http://server", "opened_projects", "[{a}]")
    pusher.push("http://server", "last_project", "/a")

    await Promise.resolve()
    expect(values).toContain("last_project:/a")
    expect(values).toContain("opened_projects:[{a}]")

    gate.resolve()
    await pusher.whenIdle()
    expect(pusher.isBusy()).toBe(false)
  })

  test("isBusy is true while a write is pending or in flight", async () => {
    const gate = deferred()
    const push: PreferencePush = async () => {
      await gate.promise
    }
    const pusher = createLatestPreferencePusher(push)
    expect(pusher.isBusy()).toBe(false)
    pusher.push("http://server", "opened_projects", "[]")
    expect(pusher.isBusy("opened_projects")).toBe(true)
    gate.resolve()
    await pusher.whenIdle()
    expect(pusher.isBusy()).toBe(false)
  })
})

describe("mergeOpenedProjects", () => {
  const normalize = (worktree: string) => worktree.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

  test("keeps local-only opens when remote is a shorter stale snapshot", () => {
    const local = [
      { worktree: "E:\\works\\A", expanded: true },
      { worktree: "E:\\works\\B", expanded: true },
      { worktree: "E:\\works\\C", expanded: false },
    ]
    const remote = [
      { worktree: "E:\\works\\A", expanded: true },
      { worktree: "E:\\works\\B", expanded: true },
    ]
    expect(mergeOpenedProjects(local, remote, normalize)).toEqual(local)
  })

  test("appends remote-only opens after local order", () => {
    const local = [{ worktree: "E:\\works\\A", expanded: true }]
    const remote = [
      { worktree: "E:\\works\\B", expanded: false },
      { worktree: "E:\\works\\A", expanded: true },
    ]
    expect(mergeOpenedProjects(local, remote, normalize)).toEqual([
      { worktree: "E:\\works\\A", expanded: true },
      { worktree: "E:\\works\\B", expanded: false },
    ])
  })

  test("dedupes by normalized path and prefers local expanded flag", () => {
    const local = [{ worktree: "E:\\works\\Repo\\", expanded: false }]
    const remote = [{ worktree: "E:\\works\\repo", expanded: true }]
    expect(mergeOpenedProjects(local, remote, normalize)).toEqual([
      { worktree: "E:\\works\\repo", expanded: false },
    ])
  })

  test("returns remote when local is empty", () => {
    const remote = [{ worktree: "/a", expanded: true }]
    expect(mergeOpenedProjects(undefined, remote, normalize)).toEqual(remote)
  })

  test("returns local when remote is empty", () => {
    const local = [{ worktree: "/a", expanded: true }]
    expect(mergeOpenedProjects(local, undefined, normalize)).toEqual(local)
  })
})

describe("mergeOpenedProjectsRemoteFirst", () => {
  const normalize = (worktree: string) => worktree.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

  test("uses remote order for shared entries and appends local-only", () => {
    const local = [
      { worktree: "E:\\works\\C", expanded: true },
      { worktree: "E:\\works\\A", expanded: false },
      { worktree: "E:\\works\\B", expanded: true },
    ]
    const remote = [
      { worktree: "E:\\works\\A", expanded: true },
      { worktree: "E:\\works\\B", expanded: true },
    ]
    expect(mergeOpenedProjectsRemoteFirst(local, remote, normalize)).toEqual([
      { worktree: "E:\\works\\A", expanded: false },
      { worktree: "E:\\works\\B", expanded: true },
      { worktree: "E:\\works\\C", expanded: true },
    ])
  })

  test("keeps local-only opens when remote is shorter", () => {
    const local = [
      { worktree: "/a", expanded: true },
      { worktree: "/b", expanded: true },
      { worktree: "/c", expanded: false },
    ]
    const remote = [
      { worktree: "/a", expanded: true },
      { worktree: "/b", expanded: true },
    ]
    expect(mergeOpenedProjectsRemoteFirst(local, remote, normalize)).toEqual([
      { worktree: "/a", expanded: true },
      { worktree: "/b", expanded: true },
      { worktree: "/c", expanded: false },
    ])
  })
})

describe("resolveOpenedProjectsFromRemote", () => {
  test("uses remote when present including empty list", () => {
    const local = [
      { worktree: "/a", expanded: true },
      { worktree: "/b", expanded: false },
    ]
    expect(resolveOpenedProjectsFromRemote(local, [])).toEqual({ projects: [], source: "remote" })
    expect(resolveOpenedProjectsFromRemote(local, [{ worktree: "/a", expanded: true }])).toEqual({
      projects: [{ worktree: "/a", expanded: true }],
      source: "remote",
    })
  })

  test("keeps local when remote key is missing", () => {
    const local = [{ worktree: "/a", expanded: true }]
    expect(resolveOpenedProjectsFromRemote(local, undefined)).toEqual({
      projects: [{ worktree: "/a", expanded: true }],
      source: "local",
    })
    expect(resolveOpenedProjectsFromRemote(local, null)).toEqual({
      projects: [{ worktree: "/a", expanded: true }],
      source: "local",
    })
  })

  test("does not union local-only opens into remote snapshot", () => {
    const local = [
      { worktree: "/a", expanded: true },
      { worktree: "/closed", expanded: true },
    ]
    const remote = [{ worktree: "/a", expanded: false }]
    expect(resolveOpenedProjectsFromRemote(local, remote)).toEqual({
      projects: [{ worktree: "/a", expanded: false }],
      source: "remote",
    })
  })
})

describe("openedProjectsEqual", () => {
  test("returns true for equal snapshots including expanded coercion", () => {
    // given
    const left = [{ worktree: "E:\\works\\A", expanded: true }, { worktree: "E:\\works\\B", expanded: false }]
    const right = [{ worktree: "E:\\works\\A", expanded: true }, { worktree: "E:\\works\\B", expanded: false }]
    // when / then
    expect(openedProjectsEqual(left, right)).toBe(true)
    expect(openedProjectsEqual(left, normalizeOpenedProjects(right))).toBe(true)
  })

  test("returns false when order, path, or expanded differs", () => {
    // given
    const base = [{ worktree: "/a", expanded: true }, { worktree: "/b", expanded: false }]
    // when / then
    expect(openedProjectsEqual(base, [{ worktree: "/b", expanded: false }, { worktree: "/a", expanded: true }])).toBe(
      false,
    )
    expect(openedProjectsEqual(base, [{ worktree: "/a", expanded: true }])).toBe(false)
    expect(openedProjectsEqual(base, [{ worktree: "/a", expanded: false }, { worktree: "/b", expanded: false }])).toBe(
      false,
    )
  })

  test("treats undefined and empty as equal", () => {
    expect(openedProjectsEqual(undefined, [])).toBe(true)
    expect(openedProjectsEqual(undefined, undefined)).toBe(true)
  })
})
