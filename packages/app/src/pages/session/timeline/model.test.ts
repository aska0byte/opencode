import { afterEach, describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, UserMessage } from "@opencode-ai/sdk/v2"
import {
  clearForceSessionSync,
  FORCE_SYNC_DEBOUNCE_MS,
  isBusySessionStatus,
  isTimelineReady,
  loadOlderTimeline,
  scheduleForceSessionSync,
  selectUserMessages,
  selectVisibleUserMessages,
  shouldForceSessionTimelineSync,
} from "./model"

const user = (id: string) => ({ id, role: "user" }) as UserMessage
const assistant = (id: string) => ({ id, role: "assistant" }) as AssistantMessage

describe("timeline model", () => {
  test("selects users and applies the revert boundary", () => {
    const messages: Message[] = [user("msg_z"), assistant("msg_a"), user("msg_b"), user("msg_c")]
    const users = selectUserMessages(messages)

    expect(users.map((message) => message.id)).toEqual(["msg_z", "msg_b", "msg_c"])
    expect(selectVisibleUserMessages(users, "msg_b").map((message) => message.id)).toEqual(["msg_z"])
    expect(selectVisibleUserMessages(users)).toBe(users)
  })

  test("waits for an assistant-only load to hydrate its user root", () => {
    expect(isTimelineReady([assistant("msg_2")], true)).toBe(false)
    expect(isTimelineReady([user("msg_1"), assistant("msg_2")], true)).toBe(true)
    expect(isTimelineReady([], false)).toBe(true)
  })

  test("loads exactly one opaque cursor page", async () => {
    let calls = 0
    const anchors: Array<string | boolean> = []

    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
      before: () => anchors.push("before"),
      after: (done) => anchors.push("after", done),
    })

    expect(calls).toBe(1)
    expect(anchors).toEqual(["before", "after", true])
  })

  test("stops when a page adds no raw messages", async () => {
    let calls = 0
    await loadOlderTimeline({
      sessionID: () => "ses_test",
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        calls += 1
      },
    })

    expect(calls).toBe(1)
  })

  test("does not restore an anchor after the session changes", async () => {
    let sessionID = "ses_old"
    let restore = 0

    await loadOlderTimeline({
      sessionID: () => sessionID,
      more: () => true,
      loading: () => false,
      loadMore: async () => {
        sessionID = "ses_new"
      },
      after: () => {
        restore += 1
      },
    })

    expect(restore).toBe(0)
  })

  test("releases the anchor when loading history fails", async () => {
    let restore = 0

    await expect(
      loadOlderTimeline({
        sessionID: () => "ses_test",
        more: () => true,
        loading: () => false,
        loadMore: async () => {
          throw new Error("history failed")
        },
        after: () => {
          restore += 1
        },
      }),
    ).rejects.toThrow("history failed")

    expect(restore).toBe(1)
  })

  afterEach(() => {
    clearForceSessionSync()
  })

  test("coalesces rapid force sync into one call after debounce", async () => {
    const calls: string[] = []
    for (let i = 0; i < 5; i++) {
      scheduleForceSessionSync({
        sessionID: "ses_force",
        debounceMs: FORCE_SYNC_DEBOUNCE_MS,
        sync: (sessionID, options) => {
          calls.push(`${sessionID}:${options?.force ? "force" : "soft"}`)
        },
      })
    }
    expect(calls).toEqual([])
    await Bun.sleep(FORCE_SYNC_DEBOUNCE_MS + 50)
    expect(calls).toEqual(["ses_force:force"])
  })

  test("cancels pending force sync when session changes", async () => {
    const calls: string[] = []
    const cancel = scheduleForceSessionSync({
      sessionID: "ses_old",
      debounceMs: FORCE_SYNC_DEBOUNCE_MS,
      sync: (sessionID) => {
        calls.push(sessionID)
      },
      nowSessionID: () => "ses_new",
    })
    cancel()
    await Bun.sleep(FORCE_SYNC_DEBOUNCE_MS + 50)
    expect(calls).toEqual([])
  })

  test("forces timeline hydrate whenever message cache is warm", () => {
    // Soft sync early-return is the stuck-UI path after remount/switch — always force if cached.
    expect(
      shouldForceSessionTimelineSync({ cached: true, stale: false, busy: false, switched: false }),
    ).toBe(true)
    expect(
      shouldForceSessionTimelineSync({ cached: true, stale: false, busy: false, switched: true }),
    ).toBe(true)
    expect(shouldForceSessionTimelineSync({ cached: false, switched: true, busy: true })).toBe(false)
  })

  test("recognizes busy session status types", () => {
    expect(isBusySessionStatus("busy")).toBe(true)
    expect(isBusySessionStatus("retry")).toBe(true)
    expect(isBusySessionStatus("compacting")).toBe(true)
    expect(isBusySessionStatus("idle")).toBe(false)
    expect(isBusySessionStatus(undefined)).toBe(false)
  })
})
