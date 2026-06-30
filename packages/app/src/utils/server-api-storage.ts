/**
 * Server API storage adapter for syncing client preferences.
 *
 * When the web frontend connects to the same backend as the GUI,
 * this adapter fetches/stores preferences via HTTP API so both
 * clients see identical data.
 */

const PREFERENCE_ENDPOINT = "/preference"

type Credentials = { username?: string; password?: string }

function authHeaders(credentials?: Credentials): Record<string, string> | undefined {
  if (!credentials?.password) return undefined
  const username = credentials.username ?? "opencode"
  return { Authorization: `Basic ${btoa(`${username}:${credentials.password}`)}` }
}

/**
 * Fetch all preferences from the server.
 * Returns null if the request fails (server offline, etc.)
 */
export async function fetchPreferences(
  serverUrl: string,
  credentials?: Credentials,
): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(`${serverUrl}${PREFERENCE_ENDPOINT}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...authHeaders(credentials) },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Push a single preference to the server.
 * Fire-and-forget: failures are silently ignored.
 */
export async function pushPreference(
  serverUrl: string,
  key: string,
  value: string,
  credentials?: Credentials,
): Promise<void> {
  try {
    await fetch(`${serverUrl}${PREFERENCE_ENDPOINT}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders(credentials) },
      body: JSON.stringify({ key, value }),
    })
  } catch {
    // Silently ignore — server may be offline
  }
}

/**
 * Preference keys used by the server sync system.
 */
export const PreferenceKeys = {
  /** JSON array of { worktree, expanded } objects */
  openedProjects: "opened_projects",
  /** String: last selected project worktree path */
  lastProject: "last_project",
} as const
