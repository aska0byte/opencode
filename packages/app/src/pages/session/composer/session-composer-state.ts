import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PermissionRequest, QuestionRequest, Todo } from "@opencode-ai/sdk/v2"
import { useParams } from "@solidjs/router"
import { showToast } from "@/utils/toast"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { sessionPermissionRequest, sessionQuestionRequest } from "./session-request-tree"

export const todoState = (input: {
  count: number
  done: boolean
  live: boolean
}): "hide" | "clear" | "open" | "close" => {
  if (input.count === 0) return "hide"
  if (!input.live) return "clear"
  if (!input.done) return "open"
  return "close"
}

export function isStalePermissionResponseFailure(error: unknown, permission: PermissionRequest) {
  const body = unwrapErrorBody(error)
  const tag = discriminator(body)
  const requestID = typeof body?.requestID === "string" ? body.requestID : undefined
  const message = errorMessage(error, body)
  if (tag === "PermissionNotFoundError") return isCurrentPermissionRequest(requestID, permission)
  if (message.includes("Permission request not found")) return isCurrentPermissionRequest(requestID, permission)
  return false
}

function isCurrentPermissionRequest(requestID: string | undefined, permission: PermissionRequest) {
  return !requestID || requestID === permission.id
}

function discriminator(body: Record<string, unknown> | undefined) {
  if (typeof body?._tag === "string") return body._tag
  if (typeof body?.name === "string") return body.name
}

export function removePermissionRequest(list: PermissionRequest[] | undefined, permission: PermissionRequest) {
  return (list ?? []).filter((item) => item.id !== permission.id)
}

function unwrapErrorBody(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) return objectValue(error)
  if (!error.cause || typeof error.cause !== "object" || !("body" in error.cause)) return objectValue(error)
  return objectValue((error.cause as Record<string, unknown>).body)
}

function objectValue(value: unknown) {
  if (typeof value !== "object" || value === null) return
  return value as Record<string, unknown>
}

function errorMessage(error: unknown, body = unwrapErrorBody(error)) {
  const bodyMessage = typeof body?.message === "string" ? body.message : undefined
  if (bodyMessage) return bodyMessage
  const data = objectValue(body?.data)
  const dataMessage = typeof data?.message === "string" ? data.message : undefined
  if (dataMessage) return dataMessage
  if (error instanceof Error) return error.message
  return String(error)
}

export const todoDockAtBoundary = (state: ReturnType<typeof todoState>) => state === "open"

const idle = { type: "idle" as const }

export function createSessionComposerController(options?: { closeMs?: number | (() => number) }) {
  const params = useParams()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const language = useLanguage()
  const permission = usePermission()

  const questionRequest = createMemo((): QuestionRequest | undefined => {
    return sessionQuestionRequest(sync().data.session, sync().data.question, params.id)
  })

  const permissionRequest = createMemo((): PermissionRequest | undefined => {
    return sessionPermissionRequest(sync().data.session, sync().data.permission, params.id, (item) => {
      return !permission.autoResponds(item, sdk().directory)
    })
  })

  const blocked = createMemo(() => {
    const id = params.id
    if (!id) return false
    return !!permissionRequest() || !!questionRequest()
  })

  const todos = createMemo((): Todo[] => {
    const id = params.id
    if (!id) return []
    return serverSync().session.data.todo[id] ?? []
  })

  const done = createMemo(
    () => todos().length > 0 && todos().every((todo) => todo.status === "completed" || todo.status === "cancelled"),
  )

  const live = createMemo(() => sync().data.session_working(params.id ?? "") || blocked())

  const [store, setStore] = createStore({
    sessionID: params.id,
    responding: undefined as string | undefined,
    dock: todos().length > 0 && !done() && live(),
    closing: false,
    opening: false,
    clearingTodos: false,
  })

  const permissionResponding = createMemo(() => {
    const perm = permissionRequest()
    if (!perm) return false
    return store.responding === perm.id
  })

  const decide = (response: "once" | "always" | "reject") => {
    const perm = permissionRequest()
    if (!perm) return
    if (store.responding === perm.id) return

    setStore("responding", perm.id)
    sdk()
      .api.permission.reply({ sessionID: perm.sessionID, requestID: perm.id, reply: response })
      .catch((err: unknown) => {
        if (isStalePermissionResponseFailure(err, perm)) {
          sync().set("permission", perm.sessionID, (list) => removePermissionRequest(list, perm))
          return
        }

        showToast({ title: language.t("common.requestFailed"), description: errorMessage(err) })
      })
      .finally(() => {
        setStore("responding", (id) => (id === perm.id ? undefined : id))
      })
  }

  let timer: number | undefined
  let raf: number | undefined

  const closeMs = () => {
    const value = options?.closeMs
    if (typeof value === "function") return Math.max(0, value())
    if (typeof value === "number") return Math.max(0, value)
    return 400
  }

  const scheduleClose = () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      setStore({ dock: false, closing: false })
      timer = undefined
    }, closeMs())
  }

  // Keep stale turn todos from reopening if the model never clears them (local UI only).
  const clear = () => {
    const id = params.id
    if (!id) return
    serverSync().session.set("todo", id, [])
    sync().set("todo", id, [])
  }

  /** User-driven clear: persist empty list then hide dock. */
  const clearTodos = () => {
    const id = params.id
    if (!id || store.clearingTodos) return
    setStore("clearingTodos", true)
    const directory = sdk().directory
    const client = sdk().client as {
      session: {
        updateTodo?: (input: {
          sessionID: string
          directory?: string
          todos: Todo[]
        }) => Promise<unknown>
      }
    }
    const run =
      typeof client.session.updateTodo === "function"
        ? client.session.updateTodo({ sessionID: id, directory, todos: [] })
        : Promise.resolve()
    void run
      .then(() => {
        clear()
        if (timer) window.clearTimeout(timer)
        timer = undefined
        setStore({ dock: false, closing: false, opening: false })
      })
      .catch((err: unknown) => {
        showToast({
          title: language.t("session.todo.clear.failed"),
          description: errorMessage(err),
        })
      })
      .finally(() => {
        setStore("clearingTodos", false)
      })
  }

  createEffect(
    on(
      () => [params.id, todos().length, done(), live()] as const,
      ([id, count, complete, active], previous) => {
        if (raf) cancelAnimationFrame(raf)
        raf = undefined

        const next = todoState({
          count,
          done: complete,
          live: active,
        })

        if (!previous || previous[0] !== id) {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setStore({ sessionID: id, dock: todoDockAtBoundary(next), closing: false, opening: false })
          if (next === "clear") clear()
          return
        }

        if (next === "hide") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          setStore({ dock: false, closing: false, opening: false })
          return
        }

        if (next === "clear") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          clear()
          return
        }

        if (next === "open") {
          if (timer) window.clearTimeout(timer)
          timer = undefined
          const hidden = !store.dock || store.closing
          setStore({ dock: true, closing: false })
          if (hidden) {
            setStore("opening", true)
            raf = requestAnimationFrame(() => {
              setStore("opening", false)
              raf = undefined
            })
            return
          }
          setStore("opening", false)
          return
        }

        setStore({ dock: true, opening: false, closing: true })
        if (!timer) scheduleClose()
      },
    ),
  )

  onCleanup(() => {
    if (!timer) return
    window.clearTimeout(timer)
  })

  onCleanup(() => {
    if (!raf) return
    cancelAnimationFrame(raf)
  })

  return {
    blocked,
    questionRequest,
    permissionRequest,
    permissionResponding,
    decide,
    todos,
    clearTodos,
    clearingTodos: () => store.clearingTodos,
    dock: () =>
      store.sessionID === params.id
        ? store.dock
        : todoDockAtBoundary(todoState({ count: todos().length, done: done(), live: live() })),
    closing: () => store.sessionID === params.id && store.closing,
    opening: () => store.sessionID === params.id && store.opening,
  }
}

export type SessionComposerController = ReturnType<typeof createSessionComposerController>
