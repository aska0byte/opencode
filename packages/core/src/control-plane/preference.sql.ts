import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const ClientPreferenceTable = sqliteTable("client_preference", {
  key: text().primaryKey(),
  value: text().notNull(),
  updated_at: integer()
    .notNull()
    .$default(() => Date.now()),
})
