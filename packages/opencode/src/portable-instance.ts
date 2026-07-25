import fs from "fs"
import path from "path"

export const INSTANCE_CONFIG_NAME = "instance.config" as const
export const USER_DATA_DIR_NAME = "USER_DATA" as const
export const APP_DATA_DIR_NAME = "APP_DATA" as const

export const DEFAULT_SERVER = {
  listen_global: 1 as 0 | 1,
  port: 4096,
  username: "opencode",
  password: "opencode",
} as const

export type InstanceListenGlobal = 0 | 1

export type InstanceServerConfig = {
  readonly listen_global: InstanceListenGlobal
  readonly port: number
  readonly username: string
  readonly password: string
}

export type InstanceConfigFile = {
  readonly config?: string
  readonly server?: Partial<InstanceServerConfig>
}

export type InstanceLayout = {
  readonly instanceDir: string
  readonly configPath: string
  readonly userData: string
  readonly sessionData: string
  readonly crashDumps: string
  readonly logs: string
  readonly downloads: string
  readonly appData: string
  readonly xdgDataHome: string
  readonly xdgCacheHome: string
  readonly xdgConfigHome: string
  readonly xdgStateHome: string
  readonly tmp: string
  readonly home: string
  readonly diagnostics: string
  readonly dumps: string
  readonly coreData: string
  readonly coreConfig: string
  readonly coreState: string
  readonly coreCache: string
  readonly dbPath: string
}

export type ResolvedInstanceServer = InstanceServerConfig & {
  readonly hostname: string
}

export class PortableInstanceError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "PortableInstanceError"
    this.code = code
  }
}

export function parseInstanceDirArg(argv: readonly string[], cwd: string = process.cwd()): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--instance_dir") {
      const value = argv[i + 1]
      if (!value || value.startsWith("-")) {
        throw new PortableInstanceError("missing_instance_dir", "--instance_dir requires a directory path")
      }
      return path.resolve(cwd, value)
    }
    if (arg.startsWith("--instance_dir=")) {
      const value = arg.slice("--instance_dir=".length)
      if (!value) {
        throw new PortableInstanceError("missing_instance_dir", "--instance_dir requires a directory path")
      }
      return path.resolve(cwd, value)
    }
  }
  return undefined
}

export function resolveInstanceLayout(instanceDir: string): InstanceLayout {
  const root = path.resolve(instanceDir)
  const userData = path.join(root, USER_DATA_DIR_NAME)
  const appData = path.join(root, APP_DATA_DIR_NAME)
  const xdgDataHome = path.join(appData, "data")
  const xdgCacheHome = path.join(appData, "cache")
  const xdgConfigHome = path.join(appData, "config")
  const xdgStateHome = path.join(appData, "state")
  const coreData = path.join(xdgDataHome, "opencode")
  const diagnostics = path.join(xdgStateHome, "diagnostics")
  return {
    instanceDir: root,
    configPath: path.join(root, INSTANCE_CONFIG_NAME),
    userData,
    sessionData: path.join(userData, "session"),
    crashDumps: path.join(userData, "crashDumps"),
    logs: path.join(userData, "logs"),
    downloads: path.join(userData, "downloads"),
    appData,
    xdgDataHome,
    xdgCacheHome,
    xdgConfigHome,
    xdgStateHome,
    tmp: path.join(appData, "tmp"),
    home: path.join(appData, "home"),
    diagnostics,
    dumps: path.join(diagnostics, "sidecar-dumps"),
    coreData,
    coreConfig: path.join(xdgConfigHome, "opencode"),
    coreState: path.join(xdgStateHome, "opencode"),
    coreCache: path.join(xdgCacheHome, "opencode"),
    dbPath: path.join(coreData, "opencode.db"),
  }
}

export function ensureInstanceLayout(layout: InstanceLayout): void {
  const dirs = [
    layout.userData,
    layout.sessionData,
    layout.crashDumps,
    layout.logs,
    layout.downloads,
    layout.appData,
    layout.xdgDataHome,
    layout.xdgCacheHome,
    layout.xdgConfigHome,
    layout.xdgStateHome,
    layout.tmp,
    layout.home,
    layout.diagnostics,
    layout.dumps,
    layout.coreData,
    layout.coreConfig,
    layout.coreState,
    layout.coreCache,
    path.join(layout.xdgConfigHome, "omo"),
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function parseInstanceConfig(raw: unknown): InstanceConfigFile {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PortableInstanceError("invalid_instance_config", "instance.config must be a JSON object")
  }
  const obj = raw as Record<string, unknown>
  const result: { config?: string; server?: Partial<InstanceServerConfig> } = {}

  if (obj.config !== undefined) {
    if (typeof obj.config !== "string" || !obj.config.trim()) {
      throw new PortableInstanceError("invalid_config_path", "instance.config.config must be a non-empty string")
    }
    result.config = obj.config
  }

  if (obj.server !== undefined) {
    if (obj.server === null || typeof obj.server !== "object" || Array.isArray(obj.server)) {
      throw new PortableInstanceError("invalid_server", "instance.config.server must be an object")
    }
    result.server = parseServerPartial(obj.server as Record<string, unknown>)
  }

  return result
}

function parseServerPartial(server: Record<string, unknown>): Partial<InstanceServerConfig> {
  const out: {
    listen_global?: InstanceListenGlobal
    port?: number
    username?: string
    password?: string
  } = {}

  if (server.listen_global !== undefined) {
    if (server.listen_global !== 0 && server.listen_global !== 1) {
      throw new PortableInstanceError("invalid_listen_global", "server.listen_global must be 0 or 1")
    }
    out.listen_global = server.listen_global
  }

  if (server.port !== undefined) {
    if (typeof server.port !== "number" || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535) {
      throw new PortableInstanceError("invalid_port", "server.port must be an integer 1-65535")
    }
    out.port = server.port
  }

  if (server.username !== undefined) {
    if (typeof server.username !== "string" || !server.username.trim()) {
      throw new PortableInstanceError("invalid_username", "server.username must be a non-empty string")
    }
    out.username = server.username
  }

  if (server.password !== undefined) {
    if (typeof server.password !== "string" || server.password.length === 0) {
      throw new PortableInstanceError("invalid_password", "server.password must be a non-empty string")
    }
    out.password = server.password
  }

  return out
}

export function loadInstanceConfigFile(configPath: string): InstanceConfigFile {
  if (!fs.existsSync(configPath)) return {}
  let text: string
  try {
    text = fs.readFileSync(configPath, "utf8")
  } catch (error) {
    throw new PortableInstanceError(
      "read_failed",
      `failed to read instance.config: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!text.trim()) return {}
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (error) {
    throw new PortableInstanceError(
      "invalid_json",
      `instance.config is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return parseInstanceConfig(raw)
}

export function resolveProductConfigPath(layout: InstanceLayout, file: InstanceConfigFile): string {
  const relative = file.config ?? "opencode.json"
  return path.isAbsolute(relative) ? relative : path.resolve(layout.instanceDir, relative)
}

export function resolveInstanceServer(file: InstanceConfigFile): ResolvedInstanceServer {
  const listen = file.server?.listen_global ?? DEFAULT_SERVER.listen_global
  return {
    listen_global: listen,
    port: file.server?.port ?? DEFAULT_SERVER.port,
    username: file.server?.username ?? DEFAULT_SERVER.username,
    password: file.server?.password ?? DEFAULT_SERVER.password,
    hostname: listen === 1 ? "0.0.0.0" : "127.0.0.1",
  }
}

export function writeInstanceServerConfig(configPath: string, server: InstanceServerConfig): InstanceServerConfig {
  const existing = loadInstanceConfigFile(configPath)
  const next: InstanceConfigFile = {
    ...(existing.config !== undefined ? { config: existing.config } : {}),
    server: {
      listen_global: server.listen_global,
      port: server.port,
      username: server.username,
      password: server.password,
    },
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next.server as InstanceServerConfig
}

export type ApplyInstanceEnvInput = {
  readonly layout: InstanceLayout
  readonly productConfigPath: string
  readonly env?: NodeJS.ProcessEnv
}

/** Force isolation env before any OpenCode/core import. Overwrites host values. */
export function applyInstanceEnvironment(input: ApplyInstanceEnvInput): void {
  const env = input.env ?? process.env
  const { layout, productConfigPath } = input

  env.XDG_DATA_HOME = layout.xdgDataHome
  env.XDG_CACHE_HOME = layout.xdgCacheHome
  env.XDG_CONFIG_HOME = layout.xdgConfigHome
  env.XDG_STATE_HOME = layout.xdgStateHome
  env.TMPDIR = layout.tmp
  env.TMP = layout.tmp
  env.TEMP = layout.tmp
  env.HOME = layout.home
  env.USERPROFILE = layout.home
  env.APPDATA = layout.xdgConfigHome
  env.LOCALAPPDATA = layout.xdgDataHome
  env.OPENCODE_CONFIG = productConfigPath
  env.OPENCODE_CONFIG_DIR = path.dirname(productConfigPath)
  env.OPENCODE_DB = layout.dbPath
}
