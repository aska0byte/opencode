import {
  SERVER_LISTEN_KEY,
  SERVER_PASSWORD_KEY,
  SERVER_PORT_KEY,
  SERVER_USERNAME_KEY,
} from "./store-keys"

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

type StoreLike = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

type Env = Readonly<Record<string, string | undefined>>

export function hostnameForListen(listen: LocalServerListen): "127.0.0.1" | "0.0.0.0" {
  return listen === "local" ? "127.0.0.1" : "0.0.0.0"
}

export function resolveLocalServerConfig(store: StoreLike, env: Env = process.env): LocalServerConfig {
  return {
    port: readPort(store.get(SERVER_PORT_KEY), env.OPENCODE_PORT) ?? DEFAULT_LOCAL_SERVER_CONFIG.port,
    listen:
      readListen(store.get(SERVER_LISTEN_KEY), env.OPENCODE_SERVER_HOSTNAME) ??
      DEFAULT_LOCAL_SERVER_CONFIG.listen,
    username:
      readNonEmptyString(store.get(SERVER_USERNAME_KEY), env.OPENCODE_SERVER_USERNAME) ??
      DEFAULT_LOCAL_SERVER_CONFIG.username,
    password:
      readString(store.get(SERVER_PASSWORD_KEY), env.OPENCODE_SERVER_PASSWORD) ??
      DEFAULT_LOCAL_SERVER_CONFIG.password,
  }
}

export function persistLocalServerConfig(store: StoreLike, input: unknown): LocalServerConfig {
  const config = parseLocalServerConfig(input)
  store.set(SERVER_PORT_KEY, config.port)
  store.set(SERVER_LISTEN_KEY, config.listen)
  store.set(SERVER_USERNAME_KEY, config.username)
  store.set(SERVER_PASSWORD_KEY, config.password)
  return config
}

export function parseLocalServerConfig(input: unknown): LocalServerConfig {
  if (!input || typeof input !== "object") {
    throw new Error("invalid local server config")
  }
  const raw = input as Record<string, unknown>
  const port = readPort(raw.port, undefined)
  if (port === undefined) throw new Error("invalid port")
  if (raw.listen !== "local" && raw.listen !== "global") {
    throw new Error("invalid listen mode")
  }
  const username = typeof raw.username === "string" ? raw.username.trim() : ""
  if (!username) throw new Error("username required")
  const password = typeof raw.password === "string" ? raw.password : ""
  return { port, listen: raw.listen, username, password }
}

function readPort(stored: unknown, envValue: string | undefined): number | undefined {
  const fromStore = parsePort(stored)
  if (fromStore !== undefined) return fromStore
  return parsePort(envValue)
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

function readListen(stored: unknown, hostnameEnv: string | undefined): LocalServerListen | undefined {
  if (stored === "local" || stored === "global") return stored
  if (typeof stored === "string") {
    if (stored === "127.0.0.1" || stored === "localhost") return "local"
    if (stored === "0.0.0.0") return "global"
  }
  if (hostnameEnv === "127.0.0.1" || hostnameEnv === "localhost") return "local"
  if (hostnameEnv === "0.0.0.0") return "global"
  return undefined
}

function readNonEmptyString(stored: unknown, envValue: string | undefined): string | undefined {
  const value = readString(stored, envValue)
  if (!value) return undefined
  return value
}

function readString(stored: unknown, envValue: string | undefined): string | undefined {
  if (typeof stored === "string") return stored
  if (typeof envValue === "string") return envValue
  return undefined
}
