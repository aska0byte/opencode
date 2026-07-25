import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, batch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { pathKey } from "@/utils/path-key"
import { ServerScope } from "@/utils/server-scope"
import {
  createLatestPreferencePusher,
  fetchPreferences,
  normalizeOpenedProjects,
  openedProjectsEqual,
  PreferenceKeys,
  type OpenedProjectPref,
} from "@/utils/server-api-storage"

type StoredProject = { worktree: string; expanded: boolean }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
type ServerProjectState = {
  projects: Record<string, StoredProject[]>
  lastProject: Record<string, string>
  recentlyClosed: Record<string, string[]>
}
const HEALTH_POLL_INTERVAL_MS = 10_000
// The store retains more history than is displayed. Consumers filter recently closed entries
// against the live project list (dropping deleted projects) and then cap the visible count via
// RECENTLY_CLOSED_DISPLAY_LIMIT. Retaining extra history ensures entries that are temporarily
// filtered out do not evict still-visible ones from the persisted store.
const RECENTLY_CLOSED_HISTORY_LIMIT = 16
export const RECENTLY_CLOSED_DISPLAY_LIMIT = 5

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function migrateCanonicalLocalServerState(value: unknown, canonicalLocalServer?: ServerConnection.Key) {
  if (!canonicalLocalServer || canonicalLocalServer === "local") return value
  if (!isRecord(value)) return value
  const projects = isRecord(value.projects) ? value.projects : undefined
  const lastProject = isRecord(value.lastProject) ? value.lastProject : undefined
  const previousProjects = projects?.[canonicalLocalServer]
  const previousLastProject = lastProject?.[canonicalLocalServer]
  if (!Array.isArray(previousProjects) && typeof previousLastProject !== "string") return value

  const next = { ...value }
  if (projects && Array.isArray(previousProjects)) {
    const local = Array.isArray(projects.local) ? projects.local : []
    const worktrees = new Set(
      local.flatMap((project) => (isRecord(project) && typeof project.worktree === "string" ? [project.worktree] : [])),
    )
    const migrated = previousProjects.filter((project) => {
      if (!isRecord(project) || typeof project.worktree !== "string") return true
      if (worktrees.has(project.worktree)) return false
      worktrees.add(project.worktree)
      return true
    })
    const nextProjects: Record<string, unknown> = { ...projects, local: [...local, ...migrated] }
    delete nextProjects[canonicalLocalServer]
    next.projects = nextProjects
  }
  if (lastProject && typeof previousLastProject === "string") {
    const nextLastProject = { ...lastProject }
    if (typeof nextLastProject.local !== "string") nextLastProject.local = previousLastProject
    delete nextLastProject[canonicalLocalServer]
    next.lastProject = nextLastProject
  }
  return next
}

export function createServerProjects<T extends ServerProjectState>(input: {
  scope: Accessor<ServerScope>
  store: Store<T>
  setStore: SetStoreFunction<T>
}) {
  const setStore = input.setStore as unknown as SetStoreFunction<ServerProjectState>
  const current = () => input.store.projects[input.scope()] ?? []
  const currentClosed = () => input.store.recentlyClosed?.[input.scope()] ?? []
  const remove = (directory: string) => {
    setStore(
      "projects",
      input.scope(),
      current().filter((project) => project.worktree !== directory),
    )
  }
  return {
    list: current,
    recentlyClosed: currentClosed,
    remove,
    open(directory: string) {
      const scope = input.scope()
      const key = pathKey(directory)
      const closed = currentClosed()
      if (closed.some((worktree) => pathKey(worktree) === key)) {
        setStore(
          "recentlyClosed",
          scope,
          closed.filter((worktree) => pathKey(worktree) !== key),
        )
      }
      if (current().some((project) => project.worktree === directory)) return
      setStore("projects", scope, [{ worktree: directory, expanded: true }, ...current()])
    },
    // User-initiated close: removes the project and records it in recently closed.
    // Internal, non-user removals (e.g. sandbox/worktree normalization) should use remove().
    close(directory: string) {
      remove(directory)
      const key = pathKey(directory)
      const closed = [directory, ...currentClosed().filter((worktree) => pathKey(worktree) !== key)].slice(
        0,
        RECENTLY_CLOSED_HISTORY_LIMIT,
      )
      setStore("recentlyClosed", input.scope(), closed)
    },
    expand(directory: string) {
      const index = current().findIndex((project) => project.worktree === directory)
      if (index !== -1) setStore("projects", input.scope(), index, "expanded", true)
    },
    collapse(directory: string) {
      const index = current().findIndex((project) => project.worktree === directory)
      if (index !== -1) setStore("projects", input.scope(), index, "expanded", false)
    },
    move(directory: string, toIndex: number) {
      const fromIndex = current().findIndex((project) => project.worktree === directory)
      if (fromIndex === -1 || fromIndex === toIndex) return
      const next = [...current()]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      setStore("projects", input.scope(), next)
    },
    last() {
      return input.store.lastProject[input.scope()]
    },
    touch(directory: string) {
      setStore("lastProject", input.scope(), directory)
    },
  }
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: StoredServer[]
}): Array<ServerConnection.Any> {
  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>(
    input.props?.map((v) => [ServerConnection.key(v), v]) ?? [],
  )

  for (const value of input.stored) {
    const conn: ServerConnection.Http =
      typeof value === "string"
        ? {
            type: "http" as const,
            http: { url: value },
          }
        : "http" in value
          ? value
          : { type: "http", http: value }
    const key = ServerConnection.key(conn)

    const existing = deduped.get(key)
    if (existing)
      deduped.set(key, {
        ...existing,
        ...conn,
        http: { ...existing.http, ...conn.http },
      })
    else deduped.set(key, conn)
  }

  return [...deduped.values()]
}

export namespace ServerConnection {
  type Base = { displayName?: string; label?: string }

  export type HttpBase = {
    url: string
    username?: string
    password?: string
  }

  // Regular web connections
  export type Http = {
    type: "http"
    http: HttpBase
    authToken?: boolean
  } & Base

  export type Sidecar = {
    type: "sidecar"
    http: HttpBase
  } & (
    | // Regular desktop server
    { variant: "base" }
    // WSL server (windows only)
    | {
        variant: "wsl"
        distro: string
      }
  ) &
    Base

  // Remote server desktop can SSH into
  export type Ssh = {
    type: "ssh"
    host: string
    // SSH client exposes an HTTP server for the app to use as a proxy
    http: HttpBase
  } & Base

  export type Any =
    | Http
    // All these are desktop-only
    | (Sidecar | Ssh)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar": {
        if (conn.variant === "wsl") return Key.make(`wsl:${conn.distro}`)
        return Key.make("sidecar")
      }
      case "ssh":
        return Key.make(`ssh:${conn.host}`)
    }
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }

  export const builtin = (conn: Any) => conn.type === "sidecar" && conn.variant === "base"
  export const local = (conn?: Any) =>
    !!conn && (builtin(conn) || (conn.type === "http" && isLocalHost(conn.http.url) === "local"))
}

export function nextServerAfterRemoval(
  servers: ServerConnection.Any[],
  removed: ServerConnection.Key,
  fallback: ServerConnection.Key,
) {
  const remaining = servers.filter((server) => ServerConnection.key(server) !== removed)
  const next = remaining.find((server) => ServerConnection.key(server) === fallback) ?? remaining[0]
  return next ? ServerConnection.key(next) : fallback
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  gate: true,
  init: (props: {
    defaultServer: ServerConnection.Key
    canonicalLocalServer?: ServerConnection.Key
    servers?: Array<ServerConnection.Any>
  }) => {
    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.global("server", ["server.v3"]),
        migrate: (value) => migrateCanonicalLocalServerState(value, props.canonicalLocalServer),
      },
      createStore({
        list: [] as StoredServer[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        recentlyClosed: {} as Record<string, string[]>,
      }),
    )

    const url = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      return resolveServerList({ stored: store.list, props: props.servers })
    })

    const [state, setState] = createStore({
      active: props.defaultServer,
    })

    function setActive(input: ServerConnection.Key) {
      if (state.active !== input) setState("active", input)
    }

    function add(input: ServerConnection.Http) {
      const url_ = normalizeServerUrl(input.http.url)
      if (!url_) return
      const conn: ServerConnection.Http = { ...input, authToken: undefined, http: { ...input.http, url: url_ } }
      return batch(() => {
        const existing = store.list.findIndex((x) => url(x) === url_)
        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }
        setState("active", ServerConnection.key(conn))
        return conn
      })
    }

    function remove(key: ServerConnection.Key) {
      const next = nextServerAfterRemoval(allServers(), key, props.defaultServer)
      const list = store.list.filter((x) => url(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) setState("active", next)
      })
    }

    const isReady = Object.assign(
      createMemo(() => ready() && !!state.active),
      { promise: ready.promise },
    )

    const scope = (key = state.active) => ServerScope.fromServerKey(key, props.canonicalLocalServer)
    const projects = createServerProjects({ scope, store, setStore })
    const projectStores = new Map<ServerConnection.Key, ReturnType<typeof createServerProjects>>()
    const projectsForServer = (key: ServerConnection.Key) => {
      const existing = projectStores.get(key)
      if (existing) return existing
      const next = createServerProjects({ scope: () => scope(key), store, setStore })
      projectStores.set(key, next)
      return next
    }
    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () => allServers().find((s) => ServerConnection.key(s) === state.active) ?? allServers()[0],
    )
    const isLocal = createMemo(() => ServerConnection.local(current()))

    // --- Server preference sync ---
    // opened_projects / last_project are server-authoritative across clients that share
    // the same backend. Startup and live SSE both replace local when the key exists;
    // localStorage is only seeded to the server when the key is missing.
    let resolvePreferenceReady: (() => void) | undefined
    const preferenceReadyPromise = new Promise<void>((resolve) => {
      resolvePreferenceReady = resolve
    })
    const markPreferenceReady = () => {
      resolvePreferenceReady?.()
      resolvePreferenceReady = undefined
    }
    {
      const [initialSyncDone, setInitialSyncDone] = createSignal(false)
      // Latest-wins coalesced PUTs: rapid multi-open must not let an older short list
      // finish after a newer full list and overwrite server preference.
      const preferencePusher = createLatestPreferencePusher()
      let remoteRefreshQueued = false

      const activeUrl = () => {
        const active = current()
        if (active?.type === "http") return active.http.url
        if (active?.type === "sidecar") return active.http.url
        return location.origin
      }

      const activeCredentials = (): { username?: string; password?: string } | undefined => {
        const active = current()
        if (!active?.http?.password) return undefined
        return { username: active.http.username, password: active.http.password }
      }

      /** Replace local store from remote when keys exist. Does not merge or union lists. */
      const applyRemotePrefs = (remotePrefs: Record<string, string> | null) => {
        if (!remotePrefs) return false
        // Local writes in flight own the truth until they settle; applying a stale
        // remote snapshot mid-push is the "projects disappear while opening many" path.
        if (preferencePusher.isBusy()) return false
        let changed = false
        const scopeKey = scope()

        const remoteProjects = remotePrefs[PreferenceKeys.openedProjects]
        // Key present (including "[]") → server wins. Missing key → keep local for seed.
        if (remoteProjects !== undefined) {
          try {
            const parsed = JSON.parse(remoteProjects) as OpenedProjectPref[]
            if (Array.isArray(parsed)) {
              const current = store.projects[scopeKey]
              const next = normalizeOpenedProjects(parsed)
              // Equal snapshots (including PUT self-echo) must not replace store identity:
              // thrashing projects[] remounts the sidebar rail and drops prompt selection.
              if (!openedProjectsEqual(current, next)) {
                setStore("projects", scopeKey, next)
                changed = true
              }
            }
          } catch {
            // Invalid JSON, ignore
          }
        }

        const remoteLastProject = remotePrefs[PreferenceKeys.lastProject]
        if (remoteLastProject !== undefined) {
          const localLast = store.lastProject[scopeKey]
          if (localLast !== remoteLastProject) {
            setStore("lastProject", scopeKey, remoteLastProject)
            changed = true
          }
        }

        return changed
      }

      const refreshRemotePrefs = () => {
        // Live SSE: replace so another client's intentional close/open wins.
        fetchPreferences(activeUrl(), activeCredentials())
          .then((remotePrefs) => applyRemotePrefs(remotePrefs))
          .catch(() => {
            /* server may be offline */
          })
      }

      // Sync on init: wait for local persistence, then fetch from server
      // NOTE: No { defer: true } — on Web, ready() starts as true and never changes,
      //       so defer would skip the initial (and only) run forever.
      createEffect(
        on(
          ready,
          (isReady) => {
            if (!isReady) return
            fetchPreferences(activeUrl(), activeCredentials())
              .then((remotePrefs) => {
                if (!remotePrefs) {
                  setInitialSyncDone(true)
                  markPreferenceReady()
                  return
                }

                // Server is source of truth when keys exist (including empty opened list).
                applyRemotePrefs(remotePrefs)

                // Seed only when the server has never stored the key — never re-push a
                // local-only union that would resurrect projects closed on another client.
                const scopeKey = scope()
                if (remotePrefs[PreferenceKeys.openedProjects] === undefined) {
                  const localProjects = store.projects[scopeKey]
                  if (localProjects !== undefined) {
                    preferencePusher.push(
                      activeUrl(),
                      PreferenceKeys.openedProjects,
                      JSON.stringify(localProjects),
                      activeCredentials(),
                    )
                  }
                }
                if (remotePrefs[PreferenceKeys.lastProject] === undefined) {
                  const localLast = store.lastProject[scopeKey]
                  if (localLast !== undefined) {
                    preferencePusher.push(activeUrl(), PreferenceKeys.lastProject, localLast, activeCredentials())
                  }
                }

                setInitialSyncDone(true)
                markPreferenceReady()
              })
              .catch(() => {
                // Server may be offline — mark sync done so local changes can still push
                setInitialSyncDone(true)
                markPreferenceReady()
              })
          },
        ),
      )

      // Sync on changes: only push AFTER initial server sync completes.
      // Track the serialized list for the active scope — reading `store.projects`
      // alone can miss nested setStore updates under projects[scope].
      createEffect(
        on(
          () => {
            const list = store.projects[scope()]
            return list === undefined ? undefined : JSON.stringify(list)
          },
          (serialized) => {
            if (!initialSyncDone()) return
            // Push even if empty array — user may have closed all projects
            if (serialized !== undefined) {
              preferencePusher.push(activeUrl(), PreferenceKeys.openedProjects, serialized, activeCredentials())
            }
          },
          { defer: true },
        ),
      )

      // Sync lastProject on changes (scope-keyed read so nested updates re-run)
      createEffect(
        on(
          () => store.lastProject[scope()],
          (last) => {
            if (!initialSyncDone()) return
            // Push even if empty string — user may have deselected
            if (last !== undefined) {
              preferencePusher.push(activeUrl(), PreferenceKeys.lastProject, last, activeCredentials())
            }
          },
          { defer: true },
        ),
      )

      // Listen for preference.updated SSE events from other clients
      // and re-fetch preferences to stay in sync. Skip while local PUTs are
      // coalescing so a self-echo of an intermediate snapshot cannot roll back.
      const onPreferenceRemoteUpdate = () => {
        if (preferencePusher.isBusy()) {
          remoteRefreshQueued = true
          void preferencePusher.whenIdle().then(() => {
            if (!remoteRefreshQueued) return
            remoteRefreshQueued = false
            refreshRemotePrefs()
          })
          return
        }
        refreshRemotePrefs()
      }
      window.addEventListener("opencode:preference-updated", onPreferenceRemoteUpdate)
      onCleanup(() => {
        window.removeEventListener("opencode:preference-updated", onPreferenceRemoteUpdate)
      })
    }

    return {
      ready: isReady,
      /** Resolves after the first preference fetch (or offline fallback). Autoselect should wait. */
      preferenceReady: { promise: preferenceReadyPromise },
      isLocal,
      get key() {
        return state.active
      },
      get name() {
        return serverName(current())
      },
      get list() {
        return allServers()
      },
      get current() {
        return current()
      },
      setActive,
      add,
      remove,
      scope,
      projects: {
        ...projects,
        forServer: projectsForServer,
      },
    }
  },
})
