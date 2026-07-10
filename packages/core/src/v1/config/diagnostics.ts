export * as ConfigDiagnosticsV1 from "./diagnostics"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

export const Sidecar = Schema.Struct({
  dump: Schema.optional(Schema.Boolean).annotate({
    description: "Enable desktop sidecar event-loop lag JSON dumps.",
  }),
  probe: Schema.optional(Schema.Boolean).annotate({
    description: "Enable desktop sidecar and server runtime perf probe events in lag dumps.",
  }),
  slow_threshold_ms: Schema.optional(PositiveInt).annotate({
    description: "Duration in milliseconds before a probe span is logged as slow (default: 2000).",
  }),
  dump_min_interval_ms: Schema.optional(PositiveInt).annotate({
    description: "Minimum interval in milliseconds between sidecar lag dumps (default: 30000).",
  }),
  report_lag_threshold_ms: Schema.optional(PositiveInt).annotate({
    description: "Lag threshold in milliseconds before dumps include process.report (default: 10000).",
  }),
})

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Master switch for local performance diagnostics. Defaults to false.",
  }),
  sidecar: Schema.optional(Sidecar).annotate({
    description: "Electron desktop sidecar performance diagnostics.",
  }),
}).annotate({ description: "Local performance diagnostics configuration." })

export type Info = Schema.Schema.Type<typeof Info>
