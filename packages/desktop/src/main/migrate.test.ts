import { describe, expect, test } from "bun:test"
import { shouldSkipHostMigration } from "./portable-migrate"

describe("shouldSkipHostMigration", () => {
  test("skips host AppData migration for portable instances", () => {
    expect(shouldSkipHostMigration("E:\\works\\opencode\\instance")).toBe(true)
  })

  test("keeps host AppData migration for regular installs", () => {
    expect(shouldSkipHostMigration()).toBe(false)
    expect(shouldSkipHostMigration("")).toBe(false)
  })
})
