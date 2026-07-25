import { Database } from "@opencode-ai/core/database/database"
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { stat } from "node:fs/promises"

export function dbPath(): string {
  return Database.path()
}

export function dbBytes(): Effect.Effect<number> {
  return Effect.tryPromise({
    try: async () => {
      const path = Database.path()
      if (path === ":memory:") return 0
      const info = await stat(path)
      return info.size
    },
    catch: () => 0,
  }).pipe(Effect.catch(() => Effect.succeed(0)))
}

/** freelist_count × page_size when PRAGMA available; null on failure. */
export function freelistBytes(): Effect.Effect<number | null, never, Database.Service> {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const freelist = yield* db.all<Record<string, unknown>>(sql`PRAGMA freelist_count`)
    const page = yield* db.all<Record<string, unknown>>(sql`PRAGMA page_size`)
    const pages = Number(Object.values(freelist[0] ?? {})[0])
    const pageSize = Number(Object.values(page[0] ?? {})[0])
    if (!Number.isFinite(pages) || !Number.isFinite(pageSize)) return null
    return pages * pageSize
  }).pipe(Effect.catch(() => Effect.succeed(null as number | null)))
}

export function vacuum(): Effect.Effect<void, never, Database.Service> {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    // VACUUM reclaims free pages after deletes; must run outside a transaction.
    yield* db.run("VACUUM")
  }).pipe(Effect.orDie)
}
