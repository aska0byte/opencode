/**
 * Server API storage adapter for syncing client preferences.
 *
 * When the web frontend connects to the same backend as the GUI,
 * this adapter fetches/stores preferences via HTTP API so both
 * clients see identical data.
 */

const PREFERENCE_ENDPOINT = "/preference"

export type Credentials = { username?: string; password?: string }

export type PreferencePush = (
  serverUrl: string,
  key: string,
  value: string,
  credentials?: Credentials,
) => Promise<void>

function authHeaders(credentials?: Credentials): Record<string, string> | undefined {
  if (!credentials?.password) return undefined
  const username = credentials.username ?? "opencode"
  return { Authorization: `Basic ${btoa(`${username}:${credentials.password}`)}` }
}

/**
 * Fetch all preferences from the server.
 * Returns null if the request fails (server offline, etc.)
 */
export async function fetchPreferences(
  serverUrl: string,
  credentials?: Credentials,
): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(`${serverUrl}${PREFERENCE_ENDPOINT}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...authHeaders(credentials) },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Push a single preference to the server.
 * Fire-and-forget: failures are silently ignored.
 */
export async function pushPreference(
  serverUrl: string,
  key: string,
  value: string,
  credentials?: Credentials,
): Promise<void> {
  try {
    await fetch(`${serverUrl}${PREFERENCE_ENDPOINT}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders(credentials) },
      body: JSON.stringify({ key, value }),
    })
  } catch {
    // Silently ignore — server may be offline
  }
}

type PendingPreference = {
  serverUrl: string
  value: string
  credentials?: Credentials
}

/**
 * Coalesce preference writes so rapid local updates (e.g. opening many projects)
 * only persist the latest value per key. Serializes in-flight PUTs for a key so
 * an older snapshot cannot finish after a newer one and overwrite the server.
 */
export function createLatestPreferencePusher(push: PreferencePush = pushPreference) {
  const pending = new Map<string, PendingPreference>()
  const inflight = new Set<string>()
  const waiters = new Set<() => void>()

  const notify = () => {
    for (const waiter of waiters) waiter()
  }

  const flush = async (key: string) => {
    if (inflight.has(key)) return
    inflight.add(key)
    notify()
    try {
      while (pending.has(key)) {
        const job = pending.get(key)!
        pending.delete(key)
        await push(job.serverUrl, key, job.value, job.credentials)
      }
    } finally {
      inflight.delete(key)
      notify()
      if (pending.has(key)) void flush(key)
    }
  }

  return {
    push(serverUrl: string, key: string, value: string, credentials?: Credentials) {
      pending.set(key, { serverUrl, value, credentials })
      void flush(key)
    },
    isBusy(key?: string) {
      if (key) return pending.has(key) || inflight.has(key)
      return pending.size > 0 || inflight.size > 0
    },
    /** Resolves when no preference writes are pending or in flight. */
    whenIdle() {
      if (!this.isBusy()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const waiter = () => {
          if (this.isBusy()) return
          waiters.delete(waiter)
          resolve()
        }
        waiters.add(waiter)
      })
    },
  }
}

export type LatestPreferencePusher = ReturnType<typeof createLatestPreferencePusher>

/**
 * Preference keys used by the server sync system.
 */
export const PreferenceKeys = {
  /** JSON array of { worktree, expanded } objects */
  openedProjects: "opened_projects",
  /** String: last selected project worktree path */
  lastProject: "last_project",
} as const

export type OpenedProjectPref = { worktree: string; expanded: boolean }

/**
 * Merge local + remote opened project lists (union).
 *
 * **Not used for startup/live preference sync.** Server `opened_projects` is
 * authoritative: clients replace local when the key exists (including `[]`) and
 * only seed localStorage when the key is missing. These helpers remain for tests
 * and any caller that still needs an explicit union.
 *
 * Local-first: local order wins for shared entries; remote-only entries append.
 * `pathKey` normalizes Windows path casing/trailing separators.
 */
export function mergeOpenedProjects(
  local: OpenedProjectPref[] | undefined,
  remote: OpenedProjectPref[] | undefined,
  normalize: (worktree: string) => string,
): OpenedProjectPref[] {
  return mergeOpenedProjectLists(local, remote, normalize, "local")
}

/**
 * Remote-first union: remote order for shared worktrees; local-only opens append.
 * Expanded flags still prefer the local value when both sides have the entry.
 *
 * Prefer server replace for multi-client sync; union re-opens projects closed on
 * the other side when localStorage is stale.
 */
export function mergeOpenedProjectsRemoteFirst(
  local: OpenedProjectPref[] | undefined,
  remote: OpenedProjectPref[] | undefined,
  normalize: (worktree: string) => string,
): OpenedProjectPref[] {
  return mergeOpenedProjectLists(local, remote, normalize, "remote")
}

/**
 * Resolve opened projects for server-authoritative preference sync.
 * - remote payload present (including empty array) → use remote
 * - remote missing → keep local (caller may seed server)
 */
export function resolveOpenedProjectsFromRemote(
  local: OpenedProjectPref[] | undefined,
  remote: OpenedProjectPref[] | undefined | null,
): { projects: OpenedProjectPref[]; source: "remote" | "local" } {
  if (remote !== undefined && remote !== null) {
    return { projects: normalizeOpenedProjects(remote), source: "remote" }
  }
  return { projects: local ? local.map((p) => ({ ...p })) : [], source: "local" }
}

function mergeOpenedProjectLists(
  local: OpenedProjectPref[] | undefined,
  remote: OpenedProjectPref[] | undefined,
  normalize: (worktree: string) => string,
  primary: "local" | "remote",
): OpenedProjectPref[] {
  const localList = local ?? []
  const remoteList = remote ?? []
  if (localList.length === 0) return remoteList.map((p) => ({ ...p }))
  if (remoteList.length === 0) return localList.map((p) => ({ ...p }))

  const byKey = new Map<string, OpenedProjectPref>()
  for (const project of remoteList) {
    byKey.set(normalize(project.worktree), { worktree: project.worktree, expanded: !!project.expanded })
  }
  for (const project of localList) {
    const key = normalize(project.worktree)
    const existing = byKey.get(key)
    if (existing) {
      byKey.set(key, { worktree: existing.worktree, expanded: !!project.expanded })
    } else {
      byKey.set(key, { worktree: project.worktree, expanded: !!project.expanded })
    }
  }

  const primaryList = primary === "local" ? localList : remoteList
  const secondaryList = primary === "local" ? remoteList : localList
  const seen = new Set<string>()
  const merged: OpenedProjectPref[] = []
  for (const project of primaryList) {
    const key = normalize(project.worktree)
    if (seen.has(key)) continue
    seen.add(key)
    const next = byKey.get(key)
    if (next) merged.push(next)
  }
  for (const project of secondaryList) {
    const key = normalize(project.worktree)
    if (seen.has(key)) continue
    seen.add(key)
    const next = byKey.get(key)
    if (next) merged.push(next)
  }
  return merged
}

/**
 * True when two opened-project snapshots are semantically identical.
 * Used to no-op preference replace/self-echo so Solid store identity does not thrash
 * the project rail (HoverCard remount + ResizeObserver loops + prompt caret loss).
 */
export function openedProjectsEqual(
  left: readonly OpenedProjectPref[] | undefined,
  right: readonly OpenedProjectPref[] | undefined,
): boolean {
  const a = left ?? []
  const b = right ?? []
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (!x || !y) return false
    if (x.worktree !== y.worktree) return false
    if (!!x.expanded !== !!y.expanded) return false
  }
  return true
}

/** Normalize a remote opened_projects payload into store shape. */
export function normalizeOpenedProjects(remote: readonly OpenedProjectPref[]): OpenedProjectPref[] {
  return remote.map((p) => ({ worktree: p.worktree, expanded: !!p.expanded }))
}
