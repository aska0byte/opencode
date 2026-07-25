export { Config } from "@/config/config"
export { SidecarDiagnostics } from "@/diagnostics/sidecar"
export { Server } from "./server/server"
export { bootstrap } from "./cli/bootstrap"
export { Database } from "@opencode-ai/core/database/database"
export {
  setActivePortableInstance,
  getActivePortableInstance,
  resolveLocalServerConfig,
  writeLocalServerConfig,
} from "./server/local-server-config"
