import { appendFileSync, mkdirSync } from "node:fs"
import * as http from "node:http"
import * as tls from "node:tls"
import { join } from "node:path"
import {
  applyInstanceEnvironment,
  ensureInstanceLayout,
  loadInstanceConfigFile,
  resolveInstanceLayout,
  resolveInstanceServer,
  resolveProductConfigPath,
} from "../../../opencode/src/portable-instance"
import { loadSidecarDiagnosticsConfig } from "./sidecar-diagnostics-config"
import { SidecarDump } from "./sidecar-dump"
import { SidecarPerfProbe } from "./sidecar-perf-probe"

type NodeHttpWithEnvProxy = typeof http & {
  setGlobalProxyFromEnv: () => void
}

type NodeTlsWithSystemCertificates = typeof tls & {
  getCACertificates: (type: "default" | "system") => string[]
  setDefaultCACertificates: (certificates: string[]) => void
}

type StartCommand = {
  type: "start"
  userDataPath: string
  instanceDir?: string
  hostname?: string
  port?: number
  username?: string
  password?: string
}

type StopCommand = { type: "stop" }
type SidecarCommand = StartCommand | StopCommand

type SidecarMessage =
  | { type: "ready"; url: string; port: number; username: string; password: string }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
  on(event: "close", listener: () => void): void
}

type Listener = {
  stop(close?: boolean): void | Promise<void>
}

let diagLogPath: string | undefined

function diagLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  const target = diagLogPath ?? join(process.env.XDG_STATE_HOME ?? ".", "diagnostics", "sidecar-diagnostics.log")
  try {
    mkdirSync(join(target, ".."), { recursive: true })
    appendFileSync(target, line)
  } catch (error) {
    process.stderr.write(`[sidecar-diag] failed to write diagnostics log: ${serializeError(error).message}\n`)
  }
  process.stderr.write(`[sidecar-diag] ${msg}\n`)
}

const parentPort = getParentPort()
let listener: Listener | undefined
let loopMonitor: ReturnType<typeof setInterval> | undefined
let sidecarProbe: SidecarPerfProbe | undefined
let clearServerDiagnostics: (() => void) | undefined

process.on("exit", (code: number, signal: NodeJS.Signals | undefined) => {
  diagLog(`EXIT code=${code} signal=${signal} listener=${!!listener}`)
})
process.on("uncaughtException", (err) => {
  diagLog(`UNCAUGHT EXCEPTION: ${err.stack ?? err.message}`)
})
process.on("unhandledRejection", (reason) => {
  diagLog(`UNHANDLED REJECTION: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
})
parentPort.on("close", () => {
  diagLog(`PARENT PORT CLOSED — parent disconnected, listener=${!!listener}`)
})

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === "stop") {
    void stop()
    return
  }
  void start(command)
})

async function start(command: StartCommand) {
  const resolved = resolveStart(command)
  applyStartEnv(resolved)
  diagLogPath = join(resolved.diagnosticsDir, "sidecar-diagnostics.log")
  mkdirSync(resolved.diagnosticsDir, { recursive: true })

  const diagnostics = loadSidecarDiagnosticsConfig({ log: diagLog })
  const probe = diagnostics.probe
    ? new SidecarPerfProbe({ log: diagLog, slowThresholdMs: diagnostics.slowThresholdMs })
    : undefined
  sidecarProbe = probe
  try {
    probe?.mark("sidecar.start", { hostname: resolved.hostname, port: resolved.port, instance: Boolean(command.instanceDir) })
    ensureLoopbackNoProxy()
    useSystemCertificates()
    useEnvProxy()
    probe?.mark("sidecar.env.ready")
    const serverModule = probe
      ? await probe.measure("server.import", {}, () => import("virtual:opencode-server"))
      : await import("virtual:opencode-server")
    if (resolved.instanceConfigPath) {
      serverModule.setActivePortableInstance(resolved.instanceConfigPath)
    }
    serverModule.SidecarDiagnostics.install(probe)
    clearServerDiagnostics = serverModule.SidecarDiagnostics.clear
    const sidecarDump = diagnostics.dump
      ? new SidecarDump({
          dumpDir: resolved.dumpsDir,
          log: diagLog,
          minIntervalMs: diagnostics.dumpMinIntervalMs,
          reportLagThresholdMs: diagnostics.reportLagThresholdMs,
        })
      : undefined

    const listen = () =>
      serverModule.Server.listen({
        port: resolved.port,
        hostname: resolved.hostname,
        username: resolved.username,
        password: resolved.password,
        cors: ["oc://renderer"],
      })
    listener = probe
      ? await probe.measure("server.listen", { hostname: resolved.hostname, port: resolved.port }, listen)
      : await listen()

    let lastLoopCheck = Date.now()
    loopMonitor = setInterval(() => {
      const now = Date.now()
      const lag = now - lastLoopCheck - 5000
      if (lag > 2000) {
        diagLog(`EVENT LOOP LAG ${lag}ms — server may be unresponsive`)
        sidecarDump?.captureLag({ lag, listenerActive: Boolean(listener), probe: probe?.snapshot() })
      }
      lastLoopCheck = now
    }, 5000)

    parentPort.postMessage({
      type: "ready",
      url: `http://127.0.0.1:${resolved.port}`,
      port: resolved.port,
      username: resolved.username,
      password: resolved.password,
    })
    probe?.mark("sidecar.ready")
  } catch (error) {
    const serialized = serializeError(error)
    probe?.mark("sidecar.error", { error: serialized.message })
    parentPort.postMessage({ type: "error", error: serialized })
    setImmediate(() => process.exit(1))
  }
}

async function stop() {
  sidecarProbe?.mark("sidecar.stop", { listenerActive: Boolean(listener) })
  clearServerDiagnostics?.()
  clearServerDiagnostics = undefined
  if (loopMonitor) {
    clearInterval(loopMonitor)
    loopMonitor = undefined
  }
  try {
    await listener?.stop()
  } finally {
    listener = undefined
    sidecarProbe = undefined
    parentPort.postMessage({ type: "stopped" })
    setImmediate(() => process.exit(0))
  }
}

type ResolvedStart = {
  readonly hostname: string
  readonly port: number
  readonly username: string
  readonly password: string
  readonly diagnosticsDir: string
  readonly dumpsDir: string
  readonly instanceConfigPath?: string
}

function resolveStart(command: StartCommand): ResolvedStart {
  if (command.instanceDir) {
    const layout = resolveInstanceLayout(command.instanceDir)
    ensureInstanceLayout(layout)
    const file = loadInstanceConfigFile(layout.configPath)
    const productConfigPath = resolveProductConfigPath(layout, file)
    applyInstanceEnvironment({ layout, productConfigPath })
    const server = resolveInstanceServer(file)
    return {
      hostname: server.hostname,
      port: server.port,
      username: server.username,
      password: server.password,
      diagnosticsDir: layout.diagnostics,
      dumpsDir: layout.dumps,
      instanceConfigPath: layout.configPath,
    }
  }

  const hostname = command.hostname
  const port = command.port
  const username = command.username
  const password = command.password
  if (typeof hostname !== "string" || typeof port !== "number" || typeof username !== "string" || typeof password !== "string") {
    throw new Error("non-instance sidecar start requires hostname, port, username, password")
  }
  Object.assign(process.env, {
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_SERVER_PASSWORD: password,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? command.userDataPath,
  })
  const stateHome = process.env.XDG_STATE_HOME ?? command.userDataPath
  return {
    hostname,
    port,
    username,
    password,
    diagnosticsDir: join(stateHome, "diagnostics"),
    dumpsDir: join(stateHome, "diagnostics", "sidecar-dumps"),
  }
}

function applyStartEnv(resolved: ResolvedStart) {
  process.env.OPENCODE_SERVER_USERNAME = resolved.username
  process.env.OPENCODE_SERVER_PASSWORD = resolved.password
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function useSystemCertificates() {
  try {
    const nodeTls = tls as NodeTlsWithSystemCertificates
    nodeTls.setDefaultCACertificates([
      ...new Set([...nodeTls.getCACertificates("default"), ...nodeTls.getCACertificates("system")]),
    ])
  } catch (error) {
    console.warn("failed to load system certificates", error)
  }
}

function useEnvProxy() {
  try {
    ;(http as NodeHttpWithEnvProxy).setGlobalProxyFromEnv()
  } catch (error) {
    console.warn("failed to load proxy environment", error)
  }
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== "object") return
  const command = value as Partial<StartCommand | StopCommand>
  if (command.type === "stop") return { type: "stop" }
  if (command.type !== "start") return
  if (typeof command.userDataPath !== "string") return
  const start: StartCommand = {
    type: "start",
    userDataPath: command.userDataPath,
  }
  if (typeof command.instanceDir === "string" && command.instanceDir) {
    start.instanceDir = command.instanceDir
    return start
  }
  if (typeof command.hostname === "string") start.hostname = command.hostname
  if (typeof command.port === "number") start.port = command.port
  if (typeof command.username === "string") start.username = command.username
  if (typeof command.password === "string") start.password = command.password
  return start
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort() {
  const port = process.parentPort as unknown as ParentPort | undefined
  if (!port) throw new Error("Sidecar parent port unavailable")
  return port
}
