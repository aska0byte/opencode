import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260618000000_add_daily_usage",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`daily_usage\` (
          \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
          \`date\` TEXT NOT NULL,
          \`project_id\` TEXT NOT NULL,
          \`model_id\` TEXT NOT NULL,
          \`call_count\` INTEGER NOT NULL DEFAULT 0,
          \`tokens_in\` INTEGER NOT NULL DEFAULT 0,
          \`tokens_out\` INTEGER NOT NULL DEFAULT 0,
          \`tokens_reasoning\` INTEGER NOT NULL DEFAULT 0,
          \`tokens_cache_read\` INTEGER NOT NULL DEFAULT 0,
          \`tokens_cache_write\` INTEGER NOT NULL DEFAULT 0
        )
      `)
      yield* tx.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS \`daily_usage_date_project_model\`
        ON \`daily_usage\` (\`date\`, \`project_id\`, \`model_id\`)
      `)
    })
  },
} satisfies DatabaseMigration.Migration
