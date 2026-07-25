import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../opencode/src/server/routes/instance/httpapi/api"
import { Service } from "./service"

export const sessionStorageHandlers = HttpApiBuilder.group(InstanceHttpApi, "session-storage", (handlers) =>
  Effect.gen(function* () {
    const storage = yield* Service

    return handlers
      .handle("state", () => storage.state())
      .handle("scan", (ctx) =>
        storage.scan({
          projectID: ctx.query.projectID,
          olderThan: ctx.query.olderThan,
          minBytes: ctx.query.minBytes,
          limit: ctx.query.limit,
        }),
      )
      .handle("batch", (ctx) => storage.batch(ctx.payload))
  }),
)
