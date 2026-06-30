import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../opencode/src/server/routes/instance/httpapi/api"
import { Service } from "./service"

export const usageStatsHandlers = HttpApiBuilder.group(InstanceHttpApi, "usage-stats", (handlers) =>
  Effect.gen(function* () {
    const stats = yield* Service

    return handlers
      .handle("daily", (ctx) => stats.queryByDate(ctx.query.date))
      .handle("range", (ctx) => stats.queryByRange(ctx.query.range))
      .handle("dailyRange", (ctx) => stats.queryDailyByRange(ctx.query.range))
      .handle("cleanup", (ctx) =>
        stats.cleanup(ctx.payload.keep_days).pipe(Effect.map((deleted) => ({ deleted }))),
      )
  }),
)
