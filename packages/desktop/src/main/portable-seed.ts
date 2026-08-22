import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, OLD_LAYOUT_ELIGIBLE_KEY } from "./store-keys"

export const PORTABLE_SEEDED_APP_VERSION = "1.17.20"

export function portableSettingsSeed() {
  return {
    [OLD_LAYOUT_ELIGIBLE_KEY]: true,
    [FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY]: true,
  }
}

export function portableDefaultDatSeed() {
  return {
    "settings.v3": JSON.stringify({
      general: {
        layoutTransitionEligible: true,
        newLayoutDesigns: false,
        showCustomAgents: true,
        agentVisibilityInitialized: true,
      },
    }),
    "app-version.v1": JSON.stringify({ version: PORTABLE_SEEDED_APP_VERSION }),
  }
}

export function writePortableUserDataSeed(userData: string) {
  const settingsPath = join(userData, "opencode.settings")
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, `${JSON.stringify(portableSettingsSeed(), null, 2)}\n`, "utf8")
  }
  const datPath = join(userData, "default.dat")
  if (!existsSync(datPath)) {
    writeFileSync(datPath, `${JSON.stringify(portableDefaultDatSeed(), null, 2)}\n`, "utf8")
  }
}
