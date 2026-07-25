import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { purgeWithOps, type PurgeTreeOps } from "./cleaner"
import { PROTECTED_KEY } from "./types"

type Node = {
  protected: boolean
  children: string[]
}

function fakeOps(tree: Record<string, Node>, removed: string[] = []): PurgeTreeOps {
  const live = new Map(Object.entries(tree).map(([id, n]) => [id, { ...n, children: [...n.children] }]))

  const reparentDrop = (id: string) => {
    live.delete(id)
    for (const [, node] of live) {
      node.children = node.children.filter((c) => c !== id)
    }
    removed.push(id)
  }

  return {
    exists: (id) => Effect.succeed(live.has(id)),
    getMeta: (id) => {
      const node = live.get(id)
      if (!node) return Effect.succeed(undefined)
      return Effect.succeed(node.protected ? { [PROTECTED_KEY]: true } : {})
    },
    listChildren: (id) => Effect.succeed(live.get(id)?.children ?? []),
    remove: (id) =>
      Effect.sync(() => {
        if (!live.has(id)) throw new Error("not found")
        const kids = live.get(id)?.children ?? []
        if (kids.length > 0) throw new Error("would cascade protected kids")
        reparentDrop(id)
      }),
  }
}

describe("purgeWithOps", () => {
  test("deletes entire unprotected tree", () => {
    const removed: string[] = []
    const ops = fakeOps(
      {
        root: { protected: false, children: ["c1", "c2"] },
        c1: { protected: false, children: [] },
        c2: { protected: false, children: [] },
      },
      removed,
    )
    const out = Effect.runSync(purgeWithOps("root", ops))
    expect(out).toEqual({ id: "root", ok: true })
    expect(removed.sort()).toEqual(["c1", "c2", "root"].sort())
  })

  test("keeps protected children and parent shell", () => {
    const removed: string[] = []
    const ops = fakeOps(
      {
        root: { protected: false, children: ["keep", "drop"] },
        keep: { protected: true, children: [] },
        drop: { protected: false, children: [] },
      },
      removed,
    )
    const out = Effect.runSync(purgeWithOps("root", ops))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe("has_protected_descendants")
    expect(removed).toEqual(["drop"])
  })

  test("skips protected parent but purges unprotected descendants", () => {
    const removed: string[] = []
    const ops = fakeOps(
      {
        root: { protected: true, children: ["drop"] },
        drop: { protected: false, children: [] },
      },
      removed,
    )
    const out = Effect.runSync(purgeWithOps("root", ops))
    expect(out).toEqual({ id: "root", ok: false, reason: "protected" })
    expect(removed).toEqual(["drop"])
  })

  test("not_found", () => {
    const ops = fakeOps({})
    const out = Effect.runSync(purgeWithOps("missing", ops))
    expect(out).toEqual({ id: "missing", ok: false, reason: "not_found" })
  })

  test("remove failure is not ok", () => {
    const ops: PurgeTreeOps = {
      exists: () => Effect.succeed(true),
      getMeta: () => Effect.succeed({}),
      listChildren: () => Effect.succeed([]),
      remove: () => Effect.fail(new Error("boom")),
    }
    const out = Effect.runSync(purgeWithOps("x", ops))
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toBe("error")
      expect(out.message).toBeTruthy()
    }
  })
})
