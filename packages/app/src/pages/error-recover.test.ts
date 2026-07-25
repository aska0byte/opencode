import { afterEach, describe, expect, test } from "bun:test"
import { recoverFromRendererError } from "./error-recover"

describe("recoverFromRendererError", () => {
  const windowID = "test-window-error-recover"

  afterEach(() => {
    try {
      localStorage.removeItem(`opencode.desktop.window.${windowID}.last-active-url`)
    } catch {
      // ignore
    }
  })

  test("pins desktop last-active-url to home", () => {
    localStorage.setItem(
      `opencode.desktop.window.${windowID}.last-active-url`,
      "/server/abc/session/ses_broken",
    )

    recoverFromRendererError({ windowID })

    expect(localStorage.getItem(`opencode.desktop.window.${windowID}.last-active-url`)).toBe("/")
  })

  test("calls history.replaceState with home for non-root path", () => {
    const calls: string[] = []
    const original = history.replaceState.bind(history)
    history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      calls.push(String(url ?? ""))
      return original(data, unused, url)
    }

    try {
      // Stub location-like checks: recovery only calls replaceState when not already home.
      // In bun, pathname may be "blank"; force a call by temporarily wrapping recover logic path.
      const prevPath = Object.getOwnPropertyDescriptor(location, "pathname")
      const prevSearch = Object.getOwnPropertyDescriptor(location, "search")
      const prevHash = Object.getOwnPropertyDescriptor(location, "hash")
      Object.defineProperty(location, "pathname", { configurable: true, get: () => "/session/broken" })
      Object.defineProperty(location, "search", { configurable: true, get: () => "" })
      Object.defineProperty(location, "hash", { configurable: true, get: () => "" })

      recoverFromRendererError({})
      expect(calls).toContain("/")

      if (prevPath) Object.defineProperty(location, "pathname", prevPath)
      else delete (location as { pathname?: string }).pathname
      if (prevSearch) Object.defineProperty(location, "search", prevSearch)
      if (prevHash) Object.defineProperty(location, "hash", prevHash)
    } finally {
      history.replaceState = original
    }
  })

  test("does not throw without windowID", () => {
    expect(() => recoverFromRendererError({})).not.toThrow()
  })
})
