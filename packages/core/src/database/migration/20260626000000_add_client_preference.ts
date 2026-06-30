import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260626000000_add_client_preference",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`client_preference\` (
          \`key\` TEXT PRIMARY KEY,
          \`value\` TEXT NOT NULL,
          \`updated_at\` INTEGER NOT NULL
        )
      `)
    })
  },
} satisfies DatabaseMigration.Migration
