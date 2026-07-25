import { Effect } from "effect"
import { InstanceRef } from "../../opencode/src/effect/instance-ref"
import { SessionStatus } from "../../opencode/src/session/status"

export class BusyError extends Error {
  readonly _tag = "SessionStorageBusyError"
  constructor(readonly activeCount: number) {
    super(`Cannot mutate session storage while ${activeCount} session(s) are busy or retrying`)
  }
}

/**
 * Count busy/retry sessions for the current instance (InstanceRef).
 * SessionStatus is instance-scoped; without InstanceRef (global-only call) return 0.
 * Idle is therefore best-effort for the active project, not process-wide.
 */
export const countActive = Effect.fn("SessionStorage.countActive")(function* () {
  const ctx = yield* InstanceRef
  if (!ctx) return 0

  const status = yield* SessionStatus.Service
  const map = yield* status.list()
  let count = 0
  for (const info of map.values()) {
    if (info.type === "busy" || info.type === "retry") count += 1
  }
  return count
})

export const requireIdle = Effect.fn("SessionStorage.requireIdle")(function* () {
  const active = yield* countActive()
  if (active > 0) return yield* Effect.fail(new BusyError(active))
})
