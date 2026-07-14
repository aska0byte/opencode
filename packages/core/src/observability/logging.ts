import { Effect, Formatter, Logger, type LogLevel } from "effect"
import fs from "fs"
import path from "path"
import { Global } from "../global"
import { runID } from "./shared"

/** Default max size for opencode.log before rotation (20 MiB). Override with OPENCODE_LOG_MAX_BYTES. */
export const DEFAULT_LOG_MAX_BYTES = 20 * 1024 * 1024
/** Keep this many rotated `opencode.log.*` files. Override with OPENCODE_LOG_MAX_FILES. */
export const DEFAULT_LOG_MAX_FILES = 5

function formatter(id: string = runID) {
  return Logger.map(Logger.formatStructured, (output) => {
    const messages = Array.isArray(output.message) ? output.message : [output.message]
    return [
      ["timestamp", output.timestamp],
      ["level", output.level],
      ["run", id],
      ...messages.flatMap((value) => (plain(value) ? flatten(value) : [["message", value] as const])),
      ...(output.cause === undefined ? [] : [["cause", output.cause] as const]),
      ...flatten(output.spans),
      ...flatten(output.annotations),
    ]
      .map(([key, value]) => `${key}=${format(value)}`)
      .join(" ")
  })
}

function flatten(
  input: Record<string, unknown>,
  prefix = "",
  seen = new WeakSet<object>(),
): Array<readonly [string, unknown]> {
  if (seen.has(input)) return [[prefix, "[Circular]"]]
  seen.add(input)
  const entries = Object.entries(input)
  if (entries.length === 0 && prefix) return [[prefix, input]]
  return entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return plain(value) ? flatten(value, path, seen) : [[path, value] as const]
  })
}

function plain(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function format(input: unknown) {
  const value = typeof input === "string" ? input : Formatter.format(input)
  return /^[^\s="\\]+$/.test(value) ? value : JSON.stringify(value)
}

function logMaxBytes() {
  const raw = process.env.OPENCODE_LOG_MAX_BYTES
  if (!raw) return DEFAULT_LOG_MAX_BYTES
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LOG_MAX_BYTES
}

function logMaxFiles() {
  const raw = process.env.OPENCODE_LOG_MAX_FILES
  if (!raw) return DEFAULT_LOG_MAX_FILES
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_LOG_MAX_FILES
}

/** Rotate `file` when it would exceed maxBytes; keep the newest maxFiles rotated siblings. */
export function rotateLogFile(file: string, maxBytes = logMaxBytes(), maxFiles = logMaxFiles()) {
  try {
    const st = fs.statSync(file)
    if (st.size < maxBytes) return
  } catch {
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const rotated = `${file}.${stamp}`
  try {
    fs.renameSync(file, rotated)
  } catch {
    // Windows: rename can fail if another process holds the file open.
    try {
      fs.copyFileSync(file, rotated)
      fs.truncateSync(file, 0)
    } catch {
      return
    }
  }

  pruneRotatedLogs(file, maxFiles)
}

function pruneRotatedLogs(file: string, maxFiles: number) {
  if (maxFiles <= 0) return
  const dir = path.dirname(file)
  const base = path.basename(file)
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return
  }
  const rotated = entries
    .filter((name) => name.startsWith(`${base}.`) && name !== base)
    .map((name) => {
      const full = path.join(dir, name)
      try {
        return { full, mtime: fs.statSync(full).mtimeMs }
      } catch {
        return undefined
      }
    })
    .filter((item): item is { full: string; mtime: number } => item !== undefined)
    .sort((a, b) => b.mtime - a.mtime)

  for (const item of rotated.slice(maxFiles)) {
    try {
      fs.unlinkSync(item.full)
    } catch {
      // ignore
    }
  }
}

export function fileLogger(file = path.join(Global.Path.log, "opencode.log"), id: string = runID) {
  // Do not set batch window to 0; it causes high idle CPU usage.
  // Custom flush so we can size-rotate (Effect Logger.toFile has no max-size option).
  return Logger.batched(formatter(id), {
    window: 1000,
    flush: (output) =>
      Effect.sync(() => {
        const text = output.join("\n") + "\n"
        rotateLogFile(file)
        fs.appendFileSync(file, text)
      }),
  })
}

const stderrLogger = Logger.make((options) => process.stderr.write(formatter().log(options) + "\n"))

export function minimumLogLevel() {
  const value = process.env.OPENCODE_LOG_LEVEL?.toUpperCase()
  const levels = {
    DEBUG: "Debug",
    INFO: "Info",
    WARN: "Warn",
    ERROR: "Error",
  } as const satisfies Record<string, LogLevel.LogLevel>
  return value && value in levels ? levels[value as keyof typeof levels] : levels.INFO
}

export function loggers() {
  return process.env.OPENCODE_PRINT_LOGS === "1" ? [fileLogger(), stderrLogger] : [fileLogger()]
}

export * as Logging from "./logging"
