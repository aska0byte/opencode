/** Pin navigation to home before ErrorBoundary remount so recovery does not re-open the crashed route. */
export function recoverFromRendererError(platform: { windowID?: string }) {
  if (platform.windowID && typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(`opencode.desktop.window.${platform.windowID}.last-active-url`, "/")
    } catch {
      // ignore storage failures — remount still proceeds
    }
  }
  if (typeof history === "undefined" || typeof location === "undefined") return
  try {
    if (location.pathname !== "/" || location.search || location.hash) {
      history.replaceState(null, "", "/")
    }
  } catch {
    // ignore history failures — remount still proceeds
  }
}
