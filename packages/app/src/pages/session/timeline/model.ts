import type { Message, UserMessage } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, onCleanup, untrack, type Accessor } from "solid-js"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { same } from "@/utils/same"

const emptyUserMessages: UserMessage[] = []
const sessionFreshness = 15_000
/** Coalesce burst force-refresh when timeline re-enters a stale session. */
export const FORCE_SYNC_DEBOUNCE_MS = 1_500

const forceSyncTimers = new Map<string, number>()

export function scheduleForceSessionSync(input: {
  sessionID: string
  sync: (sessionID: string, options?: { force?: boolean }) => unknown
  debounceMs?: number
  nowSessionID?: () => string | undefined
}) {
  const existing = forceSyncTimers.get(input.sessionID)
  if (existing !== undefined) window.clearTimeout(existing)
  const handle = window.setTimeout(() => {
    forceSyncTimers.delete(input.sessionID)
    if (input.nowSessionID && input.nowSessionID() !== input.sessionID) return
    void input.sync(input.sessionID, { force: true })
  }, input.debounceMs ?? FORCE_SYNC_DEBOUNCE_MS)
  forceSyncTimers.set(input.sessionID, handle)
  return () => {
    const pending = forceSyncTimers.get(input.sessionID)
    if (pending === undefined) return
    window.clearTimeout(pending)
    forceSyncTimers.delete(input.sessionID)
  }
}

export function clearForceSessionSync(sessionID?: string) {
  if (sessionID) {
    const pending = forceSyncTimers.get(sessionID)
    if (pending !== undefined) {
      window.clearTimeout(pending)
      forceSyncTimers.delete(sessionID)
    }
    return
  }
  for (const [id, pending] of forceSyncTimers) {
    window.clearTimeout(pending)
    forceSyncTimers.delete(id)
  }
}

export function createTimelineModel(input: {
  sessionID: Accessor<string | undefined>
  revertMessageID: Accessor<string | undefined>
}) {
  const serverSync = useServerSync()
  const sync = useSync()
  let refreshFrame: number | undefined
  let cancelForce: (() => void) | undefined

  const [resource] = createResource(
    () => input.sessionID(),
    (id) => {
      clearRefresh()
      if (!id) return

      const cached = untrack(() => sync().data.message[id] !== undefined)
      const stale = cached && !serverSync().session.fresh(id, sessionFreshness)

      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = undefined
        if (input.sessionID() !== id) return
        untrack(() => {
          if (!stale) return
          cancelForce = scheduleForceSessionSync({
            sessionID: id,
            sync: (sessionID, options) => sync().session.sync(sessionID, options),
            nowSessionID: () => input.sessionID(),
          })
        })
      })

      // Initial hydrate stays immediate (non-force).
      return sync().session.sync(id)
    },
  )
  const messages = createMemo(() => {
    const id = input.sessionID()
    return id ? (sync().data.message[id] ?? []) : []
  })
  const ready = createMemo(() => {
    const id = input.sessionID()
    return !id || isTimelineReady(sync().data.message[id], serverSync().session.history.loading(id))
  })
  const userMessages = createMemo(() => selectUserMessages(messages()), emptyUserMessages, { equals: same })
  const visibleUserMessages = createMemo(
    () => {
      return selectVisibleUserMessages(userMessages(), input.revertMessageID())
    },
    emptyUserMessages,
    { equals: same },
  )
  const more = createMemo(() => {
    const id = input.sessionID()
    return id ? sync().session.history.more(id) : false
  })
  const loading = createMemo(() => {
    const id = input.sessionID()
    return id ? sync().session.history.loading(id) : false
  })
  const loadOlder = async (options?: { before?: () => void; after?: (done: boolean) => void }) => {
    return loadOlderTimeline({
      sessionID: input.sessionID,
      more,
      loading,
      loadMore: (sessionID) => sync().session.history.loadMore(sessionID),
      before: options?.before,
      after: options?.after,
    })
  }

  onCleanup(clearRefresh)

  return {
    history: { loadOlder, loading, more },
    lastUserMessage: createMemo(() => visibleUserMessages().at(-1)),
    messages,
    ready,
    resource,
    userMessages,
    visibleUserMessages,
  }

  function clearRefresh() {
    if (refreshFrame !== undefined) cancelAnimationFrame(refreshFrame)
    refreshFrame = undefined
    cancelForce?.()
    cancelForce = undefined
  }
}

export function selectUserMessages(messages: Message[]) {
  return messages.filter((message): message is UserMessage => message.role === "user")
}

export function isTimelineReady(messages: Message[] | undefined, loading: boolean) {
  return messages !== undefined && (messages.some((message) => message.role === "user") || !loading)
}

export function selectVisibleUserMessages(messages: UserMessage[], revertMessageID?: string) {
  if (!revertMessageID) return messages
  return messages.filter((message) => message.id < revertMessageID)
}

export async function loadOlderTimeline(input: {
  sessionID: Accessor<string | undefined>
  more: Accessor<boolean>
  loading: Accessor<boolean>
  loadMore: (sessionID: string) => Promise<void>
  before?: () => void
  after?: (done: boolean) => void
}) {
  const id = input.sessionID()
  if (!id || !input.more() || input.loading()) return

  input.before?.()
  await input.loadMore(id).catch((error) => {
    if (input.sessionID() === id) input.after?.(true)
    throw error
  })
  if (input.sessionID() !== id) return
  input.after?.(true)
}
