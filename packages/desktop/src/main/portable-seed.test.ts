import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  PORTABLE_SEEDED_APP_VERSION,
  portableDefaultDatSeed,
  portableSettingsSeed,
  writePortableUserDataSeed,
} from "./portable-seed"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("portable USER_DATA seed", () => {
  test("marks old layout eligible and skips first-launch onboarding", () => {
    const seed = portableSettingsSeed()
    expect(seed.oldLayoutEligible).toBe(true)
    expect(seed.firstLaunchOnboardingComplete).toBe(true)
  })

  test("seeds old layout plus visible custom agents", () => {
    const dat = portableDefaultDatSeed()
    const settings = JSON.parse(dat["settings.v3"]) as {
      general: { layoutTransitionEligible: boolean; newLayoutDesigns: boolean; showCustomAgents: boolean }
    }
    expect(settings.general.layoutTransitionEligible).toBe(true)
    expect(settings.general.newLayoutDesigns).toBe(false)
    expect(settings.general.showCustomAgents).toBe(true)
    expect(JSON.parse(dat["app-version.v1"])).toEqual({ version: PORTABLE_SEEDED_APP_VERSION })
  })

  test("writes missing USER_DATA stores and keeps existing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-portable-seed-"))
    roots.push(root)
    writePortableUserDataSeed(root)
    const settingsPath = join(root, "opencode.settings")
    const datPath = join(root, "default.dat")
    expect(JSON.parse(await readFile(settingsPath, "utf8")).oldLayoutEligible).toBe(true)
    await writeFile(settingsPath, '{"oldLayoutEligible":false}\n', "utf8")
    writePortableUserDataSeed(root)
    expect(JSON.parse(await readFile(settingsPath, "utf8")).oldLayoutEligible).toBe(false)
    expect(JSON.parse(await readFile(datPath, "utf8"))["settings.v3"]).toContain("newLayoutDesigns")
  })
})
