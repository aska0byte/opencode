import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"
import { getStore } from "./store"
import { FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, OLD_LAYOUT_ELIGIBLE_KEY } from "./store-keys"
import { write as writeLog } from "./logging"

const DEFAULT_PROJECT_DIR = "Default Project"

export function initializeOldLayoutEligibility(userDataPath: string) {
  const store = getStore()
  const current = store.get(OLD_LAYOUT_ELIGIBLE_KEY)
  if (typeof current === "boolean") return current

  // Fork default: the classic (v1) layout for every account, new or old.
  // The v2 layout remains opt-in via the settings panels.
  store.set(OLD_LAYOUT_ELIGIBLE_KEY, true)
  return true
}

export function isOldLayoutEligible() {
  return getStore().get(OLD_LAYOUT_ELIGIBLE_KEY) === true
}

export function isFirstLaunchOnboardingPending() {
  const pending = getStore().get(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY) !== true
  writeLog("onboarding", "first launch onboarding pending checked", { pending })
  return pending
}

export async function finishFirstLaunchOnboarding(createDefaultProject: boolean) {
  if (!isFirstLaunchOnboardingPending()) {
    writeLog("onboarding", "first launch onboarding already completed")
    return null
  }

  const defaultProject = createDefaultProject ? join(app.getPath("documents"), DEFAULT_PROJECT_DIR) : null
  if (defaultProject) await mkdir(defaultProject, { recursive: true })

  getStore().set(FIRST_LAUNCH_ONBOARDING_COMPLETE_KEY, true)
  writeLog("onboarding", "first launch onboarding completed", { createDefaultProject, defaultProject })
  return defaultProject
}
