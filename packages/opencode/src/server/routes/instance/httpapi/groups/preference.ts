import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

const PreferenceRecord = Schema.Record(Schema.String, Schema.String).annotate({
  identifier: "PreferenceRecord",
})

const PreferencePutPayload = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
}).annotate({ identifier: "PreferencePutPayload" })

const PreferencePutResponse = Schema.Struct({
  ok: Schema.Literal(true),
}).annotate({ identifier: "PreferencePutResponse" })

export const PreferenceApi = HttpApi.make("preference")
  .add(
    HttpApiGroup.make("preference")
      .add(
        HttpApiEndpoint.get("list", "/preference", {
          success: described(PreferenceRecord, "All client preferences"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "preference.list",
            summary: "List client preferences",
            description: "Returns all client preference key-value pairs stored on the server.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.put("put", "/preference", {
          payload: PreferencePutPayload,
          success: described(PreferencePutResponse, "Preference saved"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "preference.put",
            summary: "Put a client preference",
            description:
              "Create or update a client preference. Broadcasts a preference.updated event to all connected clients.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "preference",
          description: "Client preference storage for cross-device sync.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode preference HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for client preference storage.",
    }),
  )
