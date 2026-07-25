import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Context, Layer } from "effect"
import { Session } from "../../opencode/src/session/session"
import { countActive } from "./idle-guard"
import { resolveTargets, scan } from "./scanner"
import { setProtected } from "./protect"
import { removeSession } from "./cleaner"
import { dbBytes, dbPath, freelistBytes, vacuum as runVacuum } from "./vacuum"
import type { BatchRequest, BatchResult, BatchItem, ScanFilter, ScanResult, StorageState } from "./types"

export interface Interface {
  readonly state: () => Effect.Effect<StorageState, any, any>
  readonly scan: (filter?: ScanFilter) => Effect.Effect<ScanResult, any, any>
  readonly batch: (input: BatchRequest) => Effect.Effect<BatchResult, any, any>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStorage") {}

function toItems(
  rows: readonly { id: string; title: string; approx_bytes: number; protected: boolean }[],
  action: BatchRequest["action"],
): BatchItem[] {
  return rows.map((row) => {
    if (action === "delete" && row.protected) {
      return {
        id: row.id,
        title: row.title,
        approx_bytes: row.approx_bytes,
        skipped: true,
        skip_reason: "protected" as const,
      }
    }
    return {
      id: row.id,
      title: row.title,
      approx_bytes: row.approx_bytes,
    }
  })
}

function applyAction(
  action: BatchRequest["action"],
  rows: readonly { id: string; title: string; approx_bytes: number; protected: boolean }[],
): Effect.Effect<{ applied: number; skipped: number; items: BatchItem[] }, never, Session.Service> {
  return Effect.gen(function* () {
    if (action === "vacuum") return { applied: 0, skipped: 0, items: [] }

    let applied = 0
    let skipped = 0
    const items: BatchItem[] = []

    for (const row of rows) {
      if (action === "delete") {
        const outcome = yield* removeSession(row.id)
        if (outcome.ok) {
          applied += 1
          items.push({ id: row.id, title: row.title, approx_bytes: row.approx_bytes })
        } else {
          skipped += 1
          items.push({
            id: row.id,
            title: row.title,
            approx_bytes: row.approx_bytes,
            skipped: true,
            skip_reason: outcome.reason,
            ...(outcome.message ? { error_message: outcome.message } : {}),
          })
        }
        continue
      }

      const protectOutcome = yield* setProtected(row.id, action === "protect")
      if (protectOutcome.ok) {
        applied += 1
        items.push({ id: row.id, title: row.title, approx_bytes: row.approx_bytes })
      } else {
        skipped += 1
        items.push({
          id: row.id,
          title: row.title,
          approx_bytes: row.approx_bytes,
          skipped: true,
          skip_reason: protectOutcome.reason,
          ...(protectOutcome.message ? { error_message: protectOutcome.message } : {}),
        })
      }
    }

    return { applied, skipped, items }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state: Interface["state"] = () =>
      Effect.gen(function* () {
        const active = yield* countActive()
        const bytes = yield* dbBytes()
        const freelist = yield* freelistBytes()
        return {
          idle: active === 0,
          active_session_count: active,
          db_path: dbPath(),
          db_bytes: bytes,
          freelist_bytes: freelist,
        }
      }).pipe(Effect.orDie)

    const scanFn: Interface["scan"] = (filter) => scan(filter).pipe(Effect.orDie)

    const batch: Interface["batch"] = (input) =>
      Effect.gen(function* () {
        const preview = input.preview === true
        const before = yield* dbBytes()

        if (input.action === "vacuum") {
          if (preview) {
            return {
              action: "vacuum" as const,
              preview: true,
              applied: 0,
              skipped: 0,
              approx_bytes: 0,
              items: [] as BatchItem[],
              db_bytes_before: before,
            }
          }
          const active = yield* countActive()
          if (active > 0) {
            return {
              action: "vacuum" as const,
              preview: false,
              applied: 0,
              skipped: 0,
              approx_bytes: 0,
              items: [] as BatchItem[],
              db_bytes_before: before,
              error: `Cannot mutate session storage while ${active} session(s) are busy or retrying`,
            }
          }
          yield* runVacuum()
          const after = yield* dbBytes()
          return {
            action: "vacuum" as const,
            preview: false,
            applied: 1,
            skipped: 0,
            approx_bytes: Math.max(0, before - after),
            items: [] as BatchItem[],
            db_bytes_before: before,
            db_bytes_after: after,
          }
        }

        const rows = yield* resolveTargets({ sessionIDs: input.sessionIDs, filter: input.filter })
        const items = toItems(rows, input.action)
        const actionable = items.filter((item) => !item.skipped)
        const approx = actionable.reduce((sum, item) => sum + item.approx_bytes, 0)

        if (preview) {
          return {
            action: input.action,
            preview: true,
            applied: 0,
            skipped: items.filter((item) => item.skipped).length,
            approx_bytes: approx,
            items,
            db_bytes_before: before,
          }
        }

        const active = yield* countActive()
        if (active > 0) {
          return {
            action: input.action,
            preview: false,
            applied: 0,
            skipped: items.length,
            approx_bytes: approx,
            items,
            db_bytes_before: before,
            error: `Cannot mutate session storage while ${active} session(s) are busy or retrying`,
          }
        }

        const result = yield* applyAction(input.action, rows)
        return {
          action: input.action,
          preview: false,
          applied: result.applied,
          skipped: result.skipped,
          approx_bytes: approx,
          items: result.items,
          db_bytes_before: before,
        }
      }).pipe(Effect.orDie)

    return Service.of({ state, scan: scanFn, batch })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node] })
