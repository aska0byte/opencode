import { Component, createSignal, onCleanup, onMount, startTransition } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Icon } from "@opencode-ai/ui/icon"
import { useQueryClient } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { homeSessionIndexKey } from "@/context/global-sync/home-session-index"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SettingsGeneral } from "./settings-general"
import { SettingsKeybinds } from "./settings-keybinds"
import { SettingsProviders } from "./settings-providers"
import { SettingsModels } from "./settings-models"
import { SettingsServers } from "./settings-servers"
import { UsageStatsTab } from "@opencode-ai/usage-stats/stats-tab"
import { SessionsTab } from "@opencode-ai/session-storage/sessions-tab"
import { notifySessionTabsRemoved } from "./titlebar-session-events"

const NARROW_MQ = "(max-width: 639px)"

export const DialogSettings: Component<{ defaultValue?: string }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const [tab, setTab] = createSignal(props.defaultValue ?? "general")
  const [narrow, setNarrow] = createSignal(
    typeof window !== "undefined" ? window.matchMedia(NARROW_MQ).matches : false,
  )

  onMount(() => {
    const mql = window.matchMedia(NARROW_MQ)
    const onChange = () => setNarrow(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    onCleanup(() => mql.removeEventListener("change", onChange))
  })

  const showProviders = () => {
    void dialog.show(() => <DialogSettings defaultValue="providers" />)
  }

  function handleSessionsDeleted(items: readonly { id: string; directory: string }[]) {
    const server = ServerConnection.key(serverSDK().server)
    const byDir = new Map<string, string[]>()
    for (const item of items) {
      if (!item.directory) continue
      const list = byDir.get(item.directory) ?? []
      list.push(item.id)
      byDir.set(item.directory, list)
    }
    for (const [directory, sessionIDs] of byDir) {
      notifySessionTabsRemoved({ server, directory, sessionIDs })
    }
    void queryClient.invalidateQueries({ queryKey: homeSessionIndexKey(server) })
  }

  const panelClass = () =>
    narrow()
      ? "no-scrollbar min-h-0 flex-1 overflow-auto"
      : "no-scrollbar min-h-[520px] overflow-auto"

  return (
    <Dialog size="x-large" transition class={narrow() ? "settings-dialog-narrow max-h-[100dvh]" : undefined}>
      <Tabs
        orientation={narrow() ? "horizontal" : "vertical"}
        variant="settings"
        value={tab()}
        onChange={(value) => void startTransition(() => setTab(value))}
        class={`h-full min-h-0 settings-dialog ${narrow() ? "settings-dialog-narrow-tabs flex flex-col" : ""}`}
      >
        <Tabs.List class={narrow() ? "shrink-0 overflow-x-auto w-full" : undefined}>
          <div
            class={
              narrow()
                ? "flex flex-row items-center gap-2 w-full px-2 py-2 overflow-x-auto"
                : "flex flex-col justify-between h-full w-full gap-4"
            }
          >
            <div class={narrow() ? "flex flex-row items-center gap-2 shrink-0" : "flex flex-col gap-3 w-full pt-3"}>
              <div class={narrow() ? "flex flex-row items-center gap-2" : "flex flex-col gap-3"}>
                <div class={narrow() ? "flex flex-row items-center gap-1.5" : "flex flex-col gap-1.5"}>
                  {!narrow() && <Tabs.SectionTitle>{language.t("settings.section.desktop")}</Tabs.SectionTitle>}
                  <div class={narrow() ? "flex flex-row items-center gap-1.5" : "flex flex-col gap-1.5 w-full"}>
                    <Tabs.Trigger value="general">
                      <Icon name="sliders" />
                      {language.t("settings.tab.general")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="shortcuts">
                      <Icon name="keyboard" />
                      {language.t("settings.tab.shortcuts")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                    </Tabs.Trigger>
                  </div>
                </div>

                <div class={narrow() ? "flex flex-row items-center gap-1.5" : "flex flex-col gap-1.5"}>
                  {!narrow() && <Tabs.SectionTitle>{language.t("settings.section.server")}</Tabs.SectionTitle>}
                  <div class={narrow() ? "flex flex-row items-center gap-1.5" : "flex flex-col gap-1.5 w-full"}>
                    <Tabs.Trigger value="providers">
                      <Icon name="providers" />
                      {language.t("settings.providers.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="models">
                      <Icon name="models" />
                      {language.t("settings.models.title")}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="usage">
                      <Icon name="status" />
                      模型用量
                    </Tabs.Trigger>
                    <Tabs.Trigger value="session-storage">
                      <Icon name="server" />
                      会话存储管理
                    </Tabs.Trigger>
                  </div>
                </div>
              </div>
            </div>
            {!narrow() && (
              <div class="flex flex-col gap-1 pl-1 py-1 text-12-medium text-text-weak">
                <span>{language.t("app.name.desktop")}</span>
                <span class="text-11-regular">v{platform.version}</span>
              </div>
            )}
          </div>
        </Tabs.List>
        <Tabs.Content value="general" class={panelClass()}>
          <SettingsGeneral />
        </Tabs.Content>
        <Tabs.Content value="shortcuts" class={panelClass()}>
          <SettingsKeybinds />
        </Tabs.Content>
        <Tabs.Content value="servers" class={panelClass()}>
          <SettingsServers />
        </Tabs.Content>
        <Tabs.Content value="providers" class={panelClass()}>
          <SettingsProviders onBack={showProviders} />
        </Tabs.Content>
        <Tabs.Content value="models" class={panelClass()}>
          <SettingsModels />
        </Tabs.Content>
        <Tabs.Content value="usage" class={panelClass()}>
          <UsageStatsTab serverUrl={serverSDK().url} />
        </Tabs.Content>
        <Tabs.Content value="session-storage" class={panelClass()}>
          <SessionsTab serverUrl={serverSDK().url} onDeleted={handleSessionsDeleted} />
        </Tabs.Content>
      </Tabs>
    </Dialog>
  )
}
