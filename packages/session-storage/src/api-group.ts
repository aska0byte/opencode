import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InstanceContextMiddleware } from "../../opencode/src/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../../opencode/src/server/routes/instance/httpapi/middleware/workspace-routing"
import {
  BatchRequest,
  BatchResult,
  ScanFilter,
  ScanResult,
  StorageState,
} from "./types"

export const SessionStoragePaths = {
  state: "/session-storage/state",
  scan: "/session-storage/scan",
  batch: "/session-storage/batch",
} as const

const ScanQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  projectID: Schema.optional(Schema.String),
  olderThan: Schema.optional(Schema.NumberFromString),
  minBytes: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
})

export const SessionStorageApi = HttpApi.make("session-storage")
  .add(
    HttpApiGroup.make("session-storage")
      .add(
        HttpApiEndpoint.get("state", SessionStoragePaths.state, {
          query: WorkspaceRoutingQuery,
          success: StorageState,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session-storage.state.get",
            summary: "Session storage state",
            description: "Database path/size and whether any session is busy or retrying.",
          }),
        ),
        HttpApiEndpoint.get("scan", SessionStoragePaths.scan, {
          query: ScanQuery,
          success: ScanResult,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session-storage.scan.get",
            summary: "Scan sessions for storage usage",
            description: "List root sessions with message counts and approximate storage size.",
          }),
        ),
        HttpApiEndpoint.post("batch", SessionStoragePaths.batch, {
          query: WorkspaceRoutingQuery,
          payload: BatchRequest,
          success: BatchResult,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session-storage.batch.post",
            summary: "Batch protect/unprotect/delete or vacuum",
            description:
              "Mutating actions require global idle. Set preview=true for dry-run without writes.",
          }),
        ),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          title: "session-storage",
          description: "Session storage management for local SQLite cleanup.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode session-storage HttpApi",
      version: "0.0.1",
      description: "HttpApi surface for session storage management.",
    }),
  )

export type { ScanFilter }
