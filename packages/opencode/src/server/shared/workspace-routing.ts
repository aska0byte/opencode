import { SessionID } from "@/session/schema"
import { Option, Schema } from "effect"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/experimental/workspace", action: "local" },
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

export function isLocalWorkspaceRoute(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

export function getWorkspaceRouteSessionID(url: URL) {
  if (url.pathname === "/session/status") return null

  const id =
    url.pathname.match(/^\/session\/([^/]+)(?:\/|$)/)?.[1] ??
    url.pathname.match(/^\/experimental\/session\/([^/]+)\/background$/)?.[1]
  if (!id) return null

  // Path segments may be background job UUIDs or other non-session ids (LLM/UI
  // confuse task tool task_id with call_omo/background UUIDs). Decode safely —
  // SessionID.make throws a defect and floods the error middleware ~1Hz.
  const decoded = Schema.decodeUnknownOption(SessionID)(id)
  if (Option.isNone(decoded)) return null
  return decoded.value
}

export function workspaceProxyURL(target: string | URL, requestURL: URL) {
  const proxyURL = new URL(target)
  proxyURL.pathname = `${proxyURL.pathname.replace(/\/$/, "")}${requestURL.pathname}`
  proxyURL.search = requestURL.search
  proxyURL.hash = requestURL.hash
  proxyURL.searchParams.delete("workspace")
  return proxyURL
}
