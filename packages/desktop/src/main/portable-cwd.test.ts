import { describe, expect, test } from "bun:test"
import { resolveStartupCwd } from "./portable-cwd"

describe("resolveStartupCwd", () => {
  test("uses instance home for portable instances", () => {
    expect(
      resolveStartupCwd({
        instanceHome: "D:\\app\\instance\\APP_DATA\\home",
        hostHome: "C:\\Users\\yao",
      }),
    ).toBe("D:\\app\\instance\\APP_DATA\\home")
  })

  test("keeps the real homedir for regular installs", () => {
    expect(resolveStartupCwd({ hostHome: "C:\\Users\\yao" })).toBe("C:\\Users\\yao")
  })
})
