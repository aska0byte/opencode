import { Effect } from "effect"
import { Session } from "../../opencode/src/session/session"
import { SessionID } from "../../opencode/src/session/schema"
import { PROTECTED_KEY, type ProtectOutcome } from "./types"

export function setProtected(
  sessionID: string,
  value: boolean,
): Effect.Effect<ProtectOutcome, never, Session.Service> {
  return Effect.gen(function* () {
    const session = yield* Session.Service
    const id = SessionID.make(sessionID)
    const info = yield* session.get(id).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!info) {
      return { id: sessionID, ok: false, reason: "not_found" } as const
    }
    const metadata: Record<string, unknown> = { ...(info.metadata ?? {}) }
    if (value) {
      metadata[PROTECTED_KEY] = true
    } else {
      delete metadata[PROTECTED_KEY]
    }
    const wrote = yield* session.setMetadata({ sessionID: id, metadata }).pipe(
      Effect.map(() => true as const),
      Effect.catch(() => Effect.succeed(false as const)),
    )
    if (!wrote) {
      return {
        id: sessionID,
        ok: false,
        reason: "error",
        message: "setMetadata failed",
      } as const
    }
    return { id: sessionID, ok: true } as const
  })
}
