import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { type Component, Show, createMemo, createResource, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform, type LocalServerConfig, type LocalServerListen } from "@/context/platform"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"
import { showToast } from "@/utils/toast"
import { SettingsList } from "./settings-list"

type DraftConfig = {
  port: number
  listen: LocalServerListen
  username: string
  password: string
}

const DEFAULT_DRAFT: DraftConfig = {
  port: 4096,
  listen: "global",
  username: "opencode",
  password: "opencode",
}

type ListenOption = {
  id: LocalServerListen
  label: string
}

export const SettingsLocalServer: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const available = createMemo(() => {
    if (platform.getLocalServerConfig && platform.setLocalServerConfig) return true
    const active = server.current
    return !!active?.http?.url
  })

  const [draft, setDraft] = createStore<DraftConfig>({ ...DEFAULT_DRAFT })
  const [loaded, setLoaded] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [showPassword, setShowPassword] = createSignal(false)

  const [config] = createResource(
    () => (available() ? "load" : false),
    async () => {
      const next = await loadLocalServerConfig(platform, server)
      if (!next) return DEFAULT_DRAFT
      setDraft({
        port: next.port,
        listen: next.listen,
        username: next.username,
        password: next.password,
      })
      setLoaded(true)
      return next
    },
  )

  const listenOptions = createMemo<ListenOption[]>(() => [
    { id: "global", label: language.t("settings.localServer.listen.global") },
    { id: "local", label: language.t("settings.localServer.listen.local") },
  ])

  const summary = createMemo(() => {
    const port = draft.port
    const bind = draft.listen === "local" ? "127.0.0.1" : "0.0.0.0"
    return `http://127.0.0.1:${port}  ·  bind ${bind}`
  })

  const dirty = createMemo(() => {
    const base = config()
    if (!base || !loaded()) return false
    return (
      base.port !== draft.port ||
      base.listen !== draft.listen ||
      base.username !== draft.username ||
      base.password !== draft.password
    )
  })

  const saveAndRestart = async () => {
    setBusy(true)
    try {
      const saved = await saveLocalServerConfig(platform, server, {
        port: draft.port,
        listen: draft.listen,
        username: draft.username.trim(),
        password: draft.password,
      })
      setDraft({
        port: saved.port,
        listen: saved.listen,
        username: saved.username,
        password: saved.password,
      })
      const isDesktop = platform.platform === "desktop" && !!platform.setLocalServerConfig
      showToast({
        variant: "success",
        title: language.t("settings.localServer.saved"),
        description: isDesktop
          ? language.t("settings.localServer.restarting")
          : language.t("settings.localServer.restartProcess"),
      })
      if (isDesktop) await platform.restart()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Show when={available()}>
      <div class="flex flex-col gap-3 pb-6">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong">{language.t("settings.localServer.title")}</h3>
          <p class="text-12-regular text-text-weak">{language.t("settings.localServer.description")}</p>
          <p class="text-12-regular text-text-weak font-mono">{summary()}</p>
        </div>

        <SettingsList>
          <div class="flex flex-col gap-4 py-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-12-medium text-text-strong">{language.t("settings.general.row.serverPort.title")}</span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.general.row.serverPort.description")}
              </span>
              <TextField
                type="number"
                min="1"
                max="65535"
                value={String(draft.port)}
                onChange={(value) => {
                  const parsed = Number.parseInt(value, 10)
                  if (Number.isInteger(parsed)) setDraft("port", parsed)
                }}
                disabled={busy() || config.loading}
              />
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-12-medium text-text-strong">{language.t("settings.localServer.listen.title")}</span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.localServer.listen.description")}
              </span>
              <Select
                options={listenOptions()}
                current={listenOptions().find((item) => item.id === draft.listen)}
                label={(item) => item.label}
                value={(item) => item.id}
                onSelect={(item) => {
                  if (!item) return
                  setDraft("listen", item.id)
                }}
                variant="secondary"
                size="small"
                disabled={busy() || config.loading}
              />
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-12-medium text-text-strong">
                {language.t("settings.general.row.serverUsername.title")}
              </span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.general.row.serverUsername.description")}
              </span>
              <TextField
                type="text"
                value={draft.username}
                onChange={(value) => setDraft("username", value)}
                disabled={busy() || config.loading}
                autocomplete="username"
              />
            </label>

            <label class="flex flex-col gap-1.5">
              <span class="text-12-medium text-text-strong">
                {language.t("settings.general.row.serverPassword.title")}
              </span>
              <span class="text-12-regular text-text-weak">
                {language.t("settings.general.row.serverPassword.description")}
              </span>
              <div class="flex items-center gap-2">
                <TextField
                  type={showPassword() ? "text" : "password"}
                  value={draft.password}
                  onChange={(value) => setDraft("password", value)}
                  disabled={busy() || config.loading}
                  autocomplete="current-password"
                  class="flex-1"
                />
                <Button
                  variant="ghost"
                  size="small"
                  type="button"
                  onClick={() => setShowPassword(!showPassword())}
                  disabled={busy()}
                >
                  {showPassword()
                    ? language.t("settings.localServer.hidePassword")
                    : language.t("settings.localServer.showPassword")}
                </Button>
              </div>
            </label>

            <div class="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="primary" size="small" disabled={busy() || config.loading} onClick={() => void saveAndRestart()}>
                {busy()
                  ? language.t("settings.localServer.restarting")
                  : dirty()
                    ? platform.platform === "desktop" && platform.setLocalServerConfig
                      ? language.t("settings.localServer.saveRestart")
                      : language.t("settings.localServer.save")
                    : platform.platform === "desktop" && platform.setLocalServerConfig
                      ? language.t("settings.localServer.restart")
                      : language.t("settings.localServer.save")}
              </Button>
              <span class="text-12-regular text-text-weak">
                {platform.platform === "desktop" && platform.setLocalServerConfig
                  ? language.t("settings.general.row.serverRestart.note")
                  : language.t("settings.localServer.restartProcess")}
              </span>
            </div>
          </div>
        </SettingsList>
      </div>
    </Show>
  )
}


async function loadLocalServerConfig(
  platform: ReturnType<typeof usePlatform>,
  server: ReturnType<typeof useServer>,
): Promise<LocalServerConfig | undefined> {
  if (platform.getLocalServerConfig) return platform.getLocalServerConfig()
  return fetchLocalServerConfig(server)
}

async function saveLocalServerConfig(
  platform: ReturnType<typeof usePlatform>,
  server: ReturnType<typeof useServer>,
  config: LocalServerConfig,
): Promise<LocalServerConfig> {
  if (platform.setLocalServerConfig) return platform.setLocalServerConfig(config)
  return putLocalServerConfig(server, config)
}

function activeHttp(server: ReturnType<typeof useServer>) {
  const active = server.current
  if (!active?.http?.url) throw new Error("no active server")
  return active.http
}

function authHeaders(http: { username?: string; password?: string }) {
  if (!http.password) return {} as Record<string, string>
  return {
    Authorization: "Basic " + authTokenFromCredentials({ username: http.username, password: http.password }),
  }
}

async function fetchLocalServerConfig(server: ReturnType<typeof useServer>): Promise<LocalServerConfig> {
  const http = activeHttp(server)
  const res = await fetch(http.url + "/global/local-server", {
    method: "GET",
    headers: { "Content-Type": "application/json", ...authHeaders(http) },
  })
  if (!res.ok) throw new Error("GET local-server failed: " + res.status)
  return res.json() as Promise<LocalServerConfig>
}

async function putLocalServerConfig(
  server: ReturnType<typeof useServer>,
  config: LocalServerConfig,
): Promise<LocalServerConfig> {
  const http = activeHttp(server)
  const res = await fetch(http.url + "/global/local-server", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(http) },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || "PUT local-server failed: " + res.status)
  }
  return res.json() as Promise<LocalServerConfig>
}
