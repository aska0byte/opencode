import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ClientPreferenceTable } from "@opencode-ai/core/control-plane/preference.sql"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceHttpApi } from "../api"

const PreferenceUpdated = EventV2.define({
  type: "preference.updated",
  schema: {
    key: Schema.String,
  },
})

export const preferenceHandlers = HttpApiBuilder.group(InstanceHttpApi, "preference", (handlers) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service

    const list = Effect.fn("PreferenceHttpApi.list")(function* () {
      const rows = yield* db.select().from(ClientPreferenceTable).all().pipe(Effect.orDie)
      const result: Record<string, string> = {}
      for (const row of rows) {
        result[row.key] = row.value
      }
      return result
    })

    const put = Effect.fn("PreferenceHttpApi.put")(function* (ctx: { payload: { key: string; value: string } }) {
      const { key, value } = ctx.payload
      const now = Date.now()

      yield* db
        .insert(ClientPreferenceTable)
        .values({ key, value, updated_at: now })
        .onConflictDoUpdate({ target: ClientPreferenceTable.key, set: { value, updated_at: now } })
        .run()
        .pipe(Effect.orDie)

      yield* events.publish(PreferenceUpdated, { key }).pipe(Effect.ignore)

      return { ok: true as const }
    })

    return handlers.handle("list", list).handle("put", put)
  }),
)
