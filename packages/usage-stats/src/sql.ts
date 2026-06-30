import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core"

export const DailyUsageTable = sqliteTable(
  "daily_usage",
  {
    id: integer().primaryKey(),
    date: text().notNull(),
    project_id: text().notNull(),
    model_id: text().notNull(),
    call_count: integer().notNull().default(0),
    tokens_in: integer().notNull().default(0),
    tokens_out: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
  },
  (table) => [
    uniqueIndex("daily_usage_date_project_model").on(table.date, table.project_id, table.model_id),
  ],
)
