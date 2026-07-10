import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const DEFAULT_SLOW_THRESHOLD_MS = 2_000
const DEFAULT_DUMP_MIN_INTERVAL_MS = 30_000
const DEFAULT_REPORT_LAG_THRESHOLD_MS = 10_000

export type SidecarDiagnosticsConfig = {
  readonly enabled: boolean
  readonly dump: boolean
  readonly probe: boolean
  readonly slowThresholdMs: number
  readonly dumpMinIntervalMs: number
  readonly reportLagThresholdMs: number
}

export type SidecarDiagnosticsConfigInput = {
  readonly log: (message: string) => void
  readonly configHome?: string
}

const DISABLED: SidecarDiagnosticsConfig = {
  enabled: false,
  dump: false,
  probe: false,
  slowThresholdMs: DEFAULT_SLOW_THRESHOLD_MS,
  dumpMinIntervalMs: DEFAULT_DUMP_MIN_INTERVAL_MS,
  reportLagThresholdMs: DEFAULT_REPORT_LAG_THRESHOLD_MS,
}

export function loadSidecarDiagnosticsConfig(input: SidecarDiagnosticsConfigInput): SidecarDiagnosticsConfig {
  const merged = configFiles(input.configHome ?? defaultConfigHome()).reduce(mergeFile(input.log), DISABLED)
  if (!merged.enabled) return DISABLED
  return merged
}

function mergeFile(log: (message: string) => void) {
  return (current: SidecarDiagnosticsConfig, file: string): SidecarDiagnosticsConfig => {
    if (!existsSync(file)) return current
    try {
      return mergeDiagnostics(current, parseJsonc(readFileSync(file, "utf8")))
    } catch (error) {
      log(`SIDECAR DIAGNOSTICS config skipped file=${file} error=${errorMessage(error)}`)
      return current
    }
  }
}

function mergeDiagnostics(current: SidecarDiagnosticsConfig, raw: unknown): SidecarDiagnosticsConfig {
  const root = record(raw)
  const diagnostics = root ? record(root.diagnostics) : undefined
  if (!diagnostics) return current

  const enabled = bool(diagnostics.enabled) ?? current.enabled
  const sidecar = record(diagnostics.sidecar)
  if (!sidecar) return { ...current, enabled }

  return {
    enabled,
    dump: bool(sidecar.dump) ?? current.dump,
    probe: bool(sidecar.probe) ?? current.probe,
    slowThresholdMs: positiveInt(sidecar.slow_threshold_ms) ?? current.slowThresholdMs,
    dumpMinIntervalMs: positiveInt(sidecar.dump_min_interval_ms) ?? current.dumpMinIntervalMs,
    reportLagThresholdMs: positiveInt(sidecar.report_lag_threshold_ms) ?? current.reportLagThresholdMs,
  }
}

function configFiles(configHome: string): readonly string[] {
  return ["config.json", "opencode.json", "opencode.jsonc"].map((file) => join(configHome, file))
}

function defaultConfigHome(): string {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

function parseJsonc(text: string): unknown {
  const parsed: unknown = JSON.parse(removeTrailingCommas(stripComments(text)))
  return parsed
}

function stripComments(text: string): string {
  let result = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]
    if (char === undefined) continue
    if (inString) {
      result += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      result += "\n"
      continue
    }
    if (char === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") result += "\n"
        i++
      }
      i++
      continue
    }
    result += char
  }
  return result
}

function removeTrailingCommas(text: string): string {
  let result = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === undefined) continue
    if (inString) {
      result += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      result += char
      continue
    }
    if (char !== ",") {
      result += char
      continue
    }

    let nextIndex = i + 1
    while (nextIndex < text.length && /\s/.test(text[nextIndex] ?? "")) nextIndex++
    const next = text[nextIndex]
    if (next === "}" || next === "]") continue
    result += char
  }
  return result
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
