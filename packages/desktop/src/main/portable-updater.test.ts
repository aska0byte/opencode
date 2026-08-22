import { describe, expect, test } from "bun:test"
import { isPortableUpdaterDisabled } from "./portable-updater"

describe("isPortableUpdaterDisabled", () => {
  test("disables updater for --instance_dir", () => {
    expect(isPortableUpdaterDisabled("D:\\app\\instance")).toBe(true)
  })

  test("keeps updater for regular installs", () => {
    expect(isPortableUpdaterDisabled()).toBe(false)
    expect(isPortableUpdaterDisabled("")).toBe(false)
  })
})
