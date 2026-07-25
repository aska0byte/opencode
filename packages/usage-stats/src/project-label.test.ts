import { describe, expect, test } from "bun:test"
import { isRootPath, pathLeaf, projectLabel, projectPathHint } from "./project-label"

describe("pathLeaf / isRootPath", () => {
  test("extracts leaf and detects root paths", () => {
    // given / when / then
    expect(pathLeaf("/a/b/foo")).toBe("foo")
    expect(pathLeaf("E:\\works\\opencode")).toBe("opencode")
    expect(pathLeaf("/")).toBe("")
    expect(isRootPath("/")).toBe(true)
    expect(isRootPath("C:/")).toBe(true)
    expect(isRootPath("/a/b")).toBe(false)
  })
})

describe("projectLabel", () => {
  test("prefers directory leaf over worktree and name", () => {
    // given / when / then
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
        project_worktree: "/",
        directory: "E:/works/opencode",
        project_id: "global",
      }),
    ).toBe("opencode")
  })

  test("falls back worktree → name → id prefix → empty marker", () => {
    // given / when / then
    expect(
      projectLabel({
        project_name: "",
        project_worktree: "/x/foo",
        directory: "/",
        project_id: "abcdefghijklmn",
      }),
    ).toBe("foo")
    expect(
      projectLabel({
        project_name: "Named",
        project_worktree: "/",
        directory: "",
        project_id: "abcdefghijklmn",
      }),
    ).toBe("Named")
    expect(
      projectLabel({
        project_name: "",
        project_worktree: "",
        directory: "",
        project_id: "abcdefghijklmn",
      }),
    ).toBe("abcdefghijkl")
    expect(
      projectLabel({
        project_name: "",
        project_worktree: "",
        directory: "",
        project_id: "",
      }),
    ).toBe("（无项目）")
  })
})

describe("projectPathHint", () => {
  test("prefers non-root directory then worktree", () => {
    // given / when / then
    expect(projectPathHint({ directory: "E:/works/opencode", project_worktree: "/x/foo" })).toBe("E:/works/opencode")
    expect(projectPathHint({ directory: "/", project_worktree: "E:/works/opencode" })).toBe("E:/works/opencode")
    expect(projectPathHint({ directory: "", project_worktree: "" })).toBe("")
  })
})
