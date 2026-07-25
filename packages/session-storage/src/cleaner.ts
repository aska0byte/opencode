import { Effect } from "effect"
import { Session } from "../../opencode/src/session/session"
import { SessionID } from "../../opencode/src/session/schema"
import { isProtected, type DeleteOutcome } from "./types"

/** Injectable tree ops for unit tests; production uses Session.Service. */
export type PurgeTreeOps = {
  readonly getMeta: (id: string) => Effect.Effect<Record<string, unknown> | undefined | null, never>
  readonly listChildren: (id: string) => Effect.Effect<readonly string[], never>
  readonly remove: (id: string) => Effect.Effect<void, unknown>
  readonly exists: (id: string) => Effect.Effect<boolean, never>
}

/**
 * Selective purge: delete unprotected sessions in the subtree; keep protected.
 * Post-order. Never call remove on a node that still has children (protected survivors).
 */
export function purgeWithOps(sessionID: string, ops: PurgeTreeOps): Effect.Effect<DeleteOutcome, never> {
  return Effect.gen(function* () {
    const exists = yield* ops.exists(sessionID)
    if (!exists) return { id: sessionID, ok: false, reason: "not_found" } as const

    const kids = yield* ops.listChildren(sessionID)
    for (const childID of kids) {
      yield* purgeWithOps(childID, ops)
    }

    const meta = yield* ops.getMeta(sessionID)
    if (isProtected(meta ?? undefined)) {
      return { id: sessionID, ok: false, reason: "protected" } as const
    }

    const remaining = yield* ops.listChildren(sessionID)
    if (remaining.length > 0) {
      return { id: sessionID, ok: false, reason: "has_protected_descendants" } as const
    }

    const removed = yield* ops.remove(sessionID).pipe(
      Effect.map(() => true as const),
      Effect.catch(() => Effect.succeed(false as const)),
    )
    if (!removed) {
      return {
        id: sessionID,
        ok: false,
        reason: "error",
        message: "Session.remove failed",
      } as const
    }
    return { id: sessionID, ok: true } as const
  })
}

function sessionOps(): Effect.Effect<PurgeTreeOps, never, Session.Service> {
  return Effect.gen(function* () {
    const session = yield* Session.Service
    return {
      exists: (id: string) =>
        session.get(SessionID.make(id)).pipe(
          Effect.map(() => true),
          Effect.catch(() => Effect.succeed(false)),
        ),
      getMeta: (id: string) =>
        session.get(SessionID.make(id)).pipe(
          Effect.map((info) => info.metadata ?? null),
          Effect.catch(() => Effect.succeed(undefined)),
        ),
      listChildren: (id: string) =>
        session.children(SessionID.make(id)).pipe(
          Effect.map((rows) => rows.map((row) => String(row.id))),
          Effect.catch(() => Effect.succeed([] as string[])),
        ),
      remove: (id: string) => session.remove(SessionID.make(id)),
    } satisfies PurgeTreeOps
  })
}

/** Production entry: selective purge for one selected root. */
export function removeSession(sessionID: string): Effect.Effect<DeleteOutcome, never, Session.Service> {
  return Effect.gen(function* () {
    const ops = yield* sessionOps()
    return yield* purgeWithOps(sessionID, ops)
  })
}
