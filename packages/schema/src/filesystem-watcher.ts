export * as FileSystemWatcher from "./filesystem-watcher"

import { Schema } from "effect"
import { optional } from "./schema"
import { define, inventory } from "./event"

const Updated = define({
  type: "file.watcher.updated",
  schema: {
    file: Schema.String,
    event: Schema.Literals(["add", "change", "unlink"]),
    /** Set when a session tool (edit/write/apply_patch) caused the change. */
    sessionID: optional(Schema.String),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
