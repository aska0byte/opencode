import path from "path"
import { readFileSync } from "node:fs"
import { Global } from "@opencode-ai/core/global"
import {
  loadInstanceConfigFile,
  resolveInstanceServer,
  writeInstanceServerConfig,
  type InstanceServerConfig,
} from "../portable-instance"

export type LocalServerListen = "local" | "global"

export type LocalServerConfig = {
  readonly port: number
  readonly listen: LocalServerListen
  readonly username: string
  readonly password: string
}

export const DEFAULT_LOCAL_SERVER_CONFIG = {
  port: 4096,
  listen: "global",
  username: "opencode",
  password: "opencode",
} as const satisfies LocalServerConfig

const FILE = path.join(Global.Path.config, "local-server.json")

/** When set, GET/PUT local-server uses instance.config instead of host local-server.json. */
let activeInstanceConfigPath: string | undefined

export function setActivePortableInstance(configPath: string | undefined): void {
  activeInstanceConfigPath = configPath
}

export function getActivePortableInstance(): string | undefined {
  return activeInstanceConfigPath
}

export function hostnameForListen(listen: LocalServerListen): "127.0.0.1" | "0.0.0.0" {
  return listen === "local" ? "127.0.0.1" : "0.0.0.0"
}

export function listenForHostname(hostname: string | undefined): LocalServerListen | undefined {
  if (hostname === "127.0.0.1" || hostname === "localhost") return "local"
  if (hostname === "0.0.0.0") return "global"
  return undefined
}

export function parseLocalServerConfig(input: unknown): LocalServerConfig {
  if (!input || typeof input !== "object") {
    throw new Error("invalid local server config")
  }
  const raw = input as Record<string, unknown>
  const port = parsePort(raw.port)
  if (port === undefined) throw new Error("invalid port")
  if (raw.listen !== "local" && raw.listen !== "global") {
    throw new Error("invalid listen mode")
  }
  const username = typeof raw.username === "string" ? raw.username.trim() : ""
  if (!username) throw new Error("username required")
  const password = typeof raw.password === "string" ? raw.password : ""
  return { port, listen: raw.listen, username, password }
}

export function resolveLocalServerConfig(env: NodeJS.ProcessEnv = process.env): LocalServerConfig {
  if (activeInstanceConfigPath) {
    return fromInstanceFile(activeInstanceConfigPath)
  }
  const file = readLocalServerConfigFileSync()
  return {
    port: file?.port ?? parsePort(env.OPENCODE_PORT) ?? DEFAULT_LOCAL_SERVER_CONFIG.port,
    listen: file?.listen ?? listenForHostname(env.OPENCODE_SERVER_HOSTNAME) ?? DEFAULT_LOCAL_SERVER_CONFIG.listen,
    username: file?.username || env.OPENCODE_SERVER_USERNAME || DEFAULT_LOCAL_SERVER_CONFIG.username,
    password: file?.password ?? env.OPENCODE_SERVER_PASSWORD ?? DEFAULT_LOCAL_SERVER_CONFIG.password,
  }
}

export function readLocalServerConfigFileSync(): LocalServerConfig | undefined {
  if (activeInstanceConfigPath) {
    return fromInstanceFile(activeInstanceConfigPath)
  }
  try {
    const text = readFileSync(FILE, "utf8")
    return parseLocalServerConfig(JSON.parse(text))
  } catch {
    return undefined
  }
}

export async function readLocalServerConfigFile(): Promise<LocalServerConfig | undefined> {
  if (activeInstanceConfigPath) {
    return fromInstanceFile(activeInstanceConfigPath)
  }
  try {
    const file = Bun.file(FILE)
    if (!(await file.exists())) return undefined
    return parseLocalServerConfig(JSON.parse(await file.text()))
  } catch {
    return undefined
  }
}

export async function writeLocalServerConfig(input: unknown): Promise<LocalServerConfig> {
  const config = parseLocalServerConfig(input)
  if (activeInstanceConfigPath) {
    writeInstanceServerConfig(activeInstanceConfigPath, toInstanceServer(config))
    return config
  }
  await Bun.write(FILE, JSON.stringify(config, null, 2) + "\n")
  return config
}

export function applyLocalServerAuthEnv(env: NodeJS.ProcessEnv = process.env): void {
  const file = readLocalServerConfigFileSync()
  if (!file) return
  if (!env.OPENCODE_SERVER_USERNAME) env.OPENCODE_SERVER_USERNAME = file.username
  if (env.OPENCODE_SERVER_PASSWORD === undefined) env.OPENCODE_SERVER_PASSWORD = file.password
}

function fromInstanceFile(configPath: string): LocalServerConfig {
  const resolved = resolveInstanceServer(loadInstanceConfigFile(configPath))
  return {
    port: resolved.port,
    listen: resolved.listen_global === 1 ? "global" : "local",
    username: resolved.username,
    password: resolved.password,
  }
}

function toInstanceServer(config: LocalServerConfig): InstanceServerConfig {
  return {
    listen_global: config.listen === "global" ? 1 : 0,
    port: config.port,
    username: config.username,
    password: config.password,
  }
}

function parsePort(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) return parsed
  }
  return undefined
}
