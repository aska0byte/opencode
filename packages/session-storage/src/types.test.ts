import { describe, expect, test } from "bun:test"
import {
  clampScanLimit,
  DEFAULT_SCAN_LIMIT,
  isProtected,
  isRootPath,
  MAX_SCAN_LIMIT,
  pathLeaf,
  projectLabel,
  PROTECTED_KEY,
  type SkipReason,
} from "./types"

describe("SkipReason", () => {
  test("literals cover purge outcomes", () => {
    const values: readonly SkipReason[] = [
      "protected",
      "has_protected_descendants",
      "not_found",
      "error",
    ]
    expect(values).toHaveLength(4)
  })
})

describe("isProtected", () => {
  test("true when metadata.protected is true", () => {
    // given
    const metadata = { [PROTECTED_KEY]: true }
    // when / then
    expect(isProtected(metadata)).toBe(true)
  })

  test("false when missing or false", () => {
    expect(isProtected(undefined)).toBe(false)
    expect(isProtected(null)).toBe(false)
    expect(isProtected({})).toBe(false)
    expect(isProtected({ [PROTECTED_KEY]: false })).toBe(false)
  })
})

describe("clampScanLimit", () => {
  test("defaults and clamps range", () => {
    expect(clampScanLimit(undefined)).toBe(DEFAULT_SCAN_LIMIT)
    expect(clampScanLimit(Number.NaN)).toBe(DEFAULT_SCAN_LIMIT)
    expect(clampScanLimit(0)).toBe(1)
    expect(clampScanLimit(-5)).toBe(1)
    expect(clampScanLimit(500)).toBe(500)
    expect(clampScanLimit(MAX_SCAN_LIMIT + 1)).toBe(MAX_SCAN_LIMIT)
  })
})

describe("pathLeaf / isRootPath", () => {
  test("extracts leaf and detects root paths", () => {
    expect(pathLeaf("/a/b/foo")).toBe("foo")
    expect(pathLeaf("E:\\works\\opencode")).toBe("opencode")
    expect(pathLeaf("/")).toBe("")
    expect(isRootPath("/")).toBe(true)
    expect(isRootPath("C:/")).toBe(true)
    expect(isRootPath("/a/b")).toBe(false)
  })
})

describe("projectLabel", () => {
  test("always prefers directory leaf over git name/worktree", () => {
    expect(
      projectLabel({
        project_name: "My App",
        project_worktree: "/x/foo",
        directory: "/y/bar",
        project_id: "p1",
      }),
    ).toBe("bar")
    expect(
      projectLabel({
        project_name: "",
        project_worktree: "/x/foo",
        directory: "E:/works/opencode",
        project_id: "p1",
      }),
    ).toBe("opencode")
    expect(
      projectLabel({
        project_name: "",
        project_worktree: "/",
        directory: "E:/works/opencode",
        project_id: "global",
      }),
    ).toBe("opencode")
    expect(
      projectLabel({
        project_name: "Fallback",
        project_worktree: "/x/foo",
        directory: "/",
        project_id: "p1",
      }),
    ).toBe("foo")
    expect(
      projectLabel({
        project_name: "",
        project_worktree: "/",
        directory: "/",
        project_id: "abcdefghijklmn",
      }),
    ).toBe("abcdefghijkl")
  })
})
