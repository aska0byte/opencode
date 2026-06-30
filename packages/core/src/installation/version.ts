declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"

/**
 * Display version with "_魔改版" suffix for local modifications.
 * Used in user-facing output like --version, health endpoint, user agent.
 * Internal semver comparisons should still use {@link InstallationVersion}.
 */
export const InstallationDisplayVersion = InstallationVersion === "local" ? "local" : `${InstallationVersion}_魔改版`

export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
