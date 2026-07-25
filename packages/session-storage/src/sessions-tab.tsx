// allow: SIZE_OK — settings session-storage tab UI (table + card + toolbar surface)
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { Component } from "solid-js"
import { DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT, projectLabel } from "./types"
import { prepareTable, type SortDir, type SortKey } from "./table-view"

type BytesBreakdown = {
  message: number
  part: number
  event: number
}

type SessionRow = {
  id: string
  project_id: string
  project_name: string
  project_worktree: string
  title: string
  directory: string
  parent_id: string | null
  time_created: number
  time_updated: number
  time_archived: number | null
  protected: boolean
  message_count: number
  approx_bytes: number
  breakdown?: BytesBreakdown
  child_session_count?: number
}

type ScanResult = {
  sessions: SessionRow[]
  session_count: number
  total_approx_bytes: number
  total_matched: number
  truncated: boolean
  limit: number
}

type StorageState = {
  idle: boolean
  active_session_count: number
  db_path: string
  db_bytes: number
  freelist_bytes?: number | null
  side_bytes?: {
    tool_output?: number
    snapshot?: number
    storage?: number
  } | null
}

type SkipReason = "protected" | "has_protected_descendants" | "not_found" | "error"

type BatchItem = {
  id: string
  title?: string
  approx_bytes?: number
  skipped?: boolean
  skip_reason?: SkipReason
  error_message?: string
}

type BatchResult = {
  action: string
  preview: boolean
  applied: number
  skipped: number
  approx_bytes: number
  items: BatchItem[]
  error?: string
  db_bytes_before?: number
  db_bytes_after?: number
}

export type DeletedSession = {
  readonly id: string
  readonly directory: string
}

const PAGE_SIZE = 100
const NARROW_MQ = "(max-width: 639px)"

const btnBase =
  "text-12-medium px-2.5 py-1.5 rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
const btnSecondary = `${btnBase} border-border-primary bg-surface-secondary text-text-strong hover:bg-surface-tertiary`
const btnPrimary = `${btnBase} border-transparent bg-surface-info text-white hover:opacity-90`
const btnDanger = `${btnBase} border-transparent bg-surface-danger text-white hover:opacity-90`
const btnOutline = `${btnBase} border-border-primary bg-transparent text-text-strong hover:bg-surface-secondary`

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(2) + " GB"
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(2) + " MB"
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB"
  return n + " B"
}

function projectTitle(row: SessionRow): string {
  const parts = [row.project_name, row.project_worktree, row.directory].filter((p) => p && p.trim())
  return parts.join("\n") || row.project_id
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString()
}

function fmtBreakdown(b: BytesBreakdown | undefined): string {
  if (!b) return ""
  return `消息 ${fmtBytes(b.message)} · 部件 ${fmtBytes(b.part)} · 事件 ${fmtBytes(b.event)}`
}

function summarizeBatch(result: BatchResult, action: string): string {
  if (result.error) return result.error
  if (action === "vacuum") {
    if (result.preview) return `预览：压缩数据库（当前 ${fmtBytes(result.db_bytes_before ?? 0)}）`
    return `已压缩数据库：${fmtBytes(result.db_bytes_before ?? 0)} → ${fmtBytes(result.db_bytes_after ?? 0)}`
  }

  const skipped = result.items.filter((item) => item.skipped)
  const byReason = (r: SkipReason) => skipped.filter((item) => item.skip_reason === r).length
  const protectedN = byReason("protected")
  const keepParentN = byReason("has_protected_descendants")
  const notFoundN = byReason("not_found")
  const errorN = byReason("error")
  const errorDetail = skipped
    .filter((item) => item.skip_reason === "error" && item.error_message)
    .slice(0, 3)
    .map((item) => item.error_message)
    .join("；")

  if (result.preview) {
    if (action === "delete") {
      const will = result.items.filter((item) => !item.skipped).length
      const parts = [
        `预览删除：将删 ${will} 个根会话（含子树未保护节点）`,
        `约 ${fmtBytes(result.approx_bytes)}`,
        protectedN > 0 ? `跳过保护 ${protectedN}` : "",
        keepParentN > 0 ? `保留父壳 ${keepParentN}` : "",
      ].filter(Boolean)
      return parts.join(" · ")
    }
    return `预览：${action === "protect" ? "保护" : "取消保护"} ${result.items.length} 个会话`
  }

  if (action === "delete") {
    const parts = [
      `已删 ${result.applied}`,
      protectedN > 0 ? `跳过保护 ${protectedN}` : "",
      keepParentN > 0 ? `因保护子保留父 ${keepParentN}` : "",
      notFoundN > 0 ? `不存在 ${notFoundN}` : "",
      errorN > 0 ? `失败 ${errorN}` : "",
      result.approx_bytes > 0 ? `估算 ${fmtBytes(result.approx_bytes)}` : "",
      "行已删，文件需「压缩数据库」才缩小",
    ].filter(Boolean)
    return errorDetail ? `${parts.join(" · ")}。${errorDetail}` : parts.join(" · ")
  }

  if (errorN > 0) {
    return `${action === "protect" ? "保护" : "取消保护"}：成功 ${result.applied} · 失败 ${errorN}${errorDetail ? `（${errorDetail}）` : ""}`
  }
  return `${action === "protect" ? "已保护" : "已取消保护"} ${result.applied} 个会话`
}

async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text().catch(() => "")
  if (!text) return `${fallback} (HTTP ${res.status})`
  try {
    const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
    const msg = json.error?.message ?? json.message
    if (msg) return `${fallback}: ${msg}`
  } catch {
    // not json
  }
  return `${fallback} (HTTP ${res.status}): ${text.slice(0, 200)}`
}

function sortMark(key: SortKey, current: SortKey, dir: SortDir): string {
  if (key !== current) return ""
  return dir === "asc" ? " ↑" : " ↓"
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "time_updated", label: "更新时间" },
  { key: "approx_bytes", label: "约占用" },
  { key: "message_count", label: "消息数" },
  { key: "title", label: "标题" },
  { key: "project_worktree", label: "项目" },
  { key: "protected", label: "保护" },
]

export const SessionsTab: Component<{
  serverUrl?: string
  directory?: string
  onDeleted?: (items: readonly DeletedSession[]) => void
}> = (props) => {
  const [selected, setSelected] = createSignal<Record<string, boolean>>({})
  const [projectFilter, setProjectFilter] = createSignal("")
  const [olderDays, setOlderDays] = createSignal(0)
  const [scanLimit, setScanLimit] = createSignal(DEFAULT_SCAN_LIMIT)
  const [sortKey, setSortKey] = createSignal<SortKey>("time_updated")
  const [sortDir, setSortDir] = createSignal<SortDir>("desc")
  const [page, setPage] = createSignal(1)
  const [message, setMessage] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [state, setState] = createSignal<StorageState | null>(null)
  const [stateError, setStateError] = createSignal<string | null>(null)
  const [scan, setScan] = createSignal<ScanResult | null>(null)
  const [scanError, setScanError] = createSignal<string | null>(null)
  const [scanning, setScanning] = createSignal(false)
  const [stateLoading, setStateLoading] = createSignal(false)
  const [narrow, setNarrow] = createSignal(false)

  onMount(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia(NARROW_MQ)
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    onCleanup(() => mq.removeEventListener("change", apply))
  })

  function api(path: string, params?: Record<string, string | number | undefined>) {
    const base = props.serverUrl ?? ""
    const q = new URLSearchParams()
    if (props.directory) q.set("directory", props.directory)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === "") continue
        q.set(key, String(value))
      }
    }
    const qs = q.toString()
    return qs ? `${base}${path}?${qs}` : `${base}${path}`
  }

  async function loadState() {
    setStateLoading(true)
    setStateError(null)
    try {
      const res = await fetch(api("/session-storage/state"))
      if (!res.ok) {
        setState(null)
        setStateError(await readError(res, "读取库状态失败"))
        return
      }
      setState((await res.json()) as StorageState)
    } catch (error) {
      setState(null)
      setStateError(error instanceof Error ? error.message : "读取库状态失败")
    } finally {
      setStateLoading(false)
    }
  }

  async function runScan() {
    if (scanning()) return
    setScanning(true)
    setScanError(null)
    setMessage(null)
    try {
      const days = olderDays()
      const res = await fetch(
        api("/session-storage/scan", {
          olderThan: days > 0 ? Date.now() - days * 86_400_000 : undefined,
          limit: scanLimit(),
        }),
      )
      if (!res.ok) {
        setScan(null)
        setScanError(await readError(res, "扫描失败"))
        return
      }
      const result = (await res.json()) as ScanResult
      setScan(result)
      setSelected({})
      setPage(1)
      const trunc = result.truncated ? `（库中匹配 ${result.total_matched}，已截断）` : ""
      setMessage(
        `扫描完成：已加载 ${result.session_count} 个根会话 · 约占用（含事件与子会话） ${fmtBytes(result.total_approx_bytes)}${trunc}`,
      )
    } catch (error) {
      setScan(null)
      setScanError(error instanceof Error ? error.message : "扫描失败")
    } finally {
      setScanning(false)
    }
  }

  const table = createMemo(() =>
    prepareTable({
      sessions: scan()?.sessions ?? [],
      projectID: projectFilter(),
      sortKey: sortKey(),
      sortDir: sortDir(),
      page: page(),
      pageSize: PAGE_SIZE,
    }),
  )

  const selectedIDs = createMemo(() =>
    Object.entries(selected())
      .filter(([, on]) => on)
      .map(([id]) => id),
  )

  const selectedRows = createMemo(() => {
    const ids = new Set(selectedIDs())
    return table().sorted.filter((row) => ids.has(row.id))
  })

  const selectedBytes = createMemo(() => selectedRows().reduce((sum, row) => sum + row.approx_bytes, 0))

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function toggleAll(on: boolean) {
    const next: Record<string, boolean> = {}
    for (const row of table().sorted) next[row.id] = on
    setSelected(next)
  }

  function onSort(key: SortKey) {
    if (sortKey() === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "title" || key === "project_worktree" ? "asc" : "desc")
    }
    setPage(1)
  }

  function confirmDelete(): boolean {
    const n = selectedIDs().length
    return confirm(
      [
        `确认清理选中的 ${n} 个根会话？`,
        "",
        "· 将删除范围内未保护会话（含子树中未保护节点）",
        "· 已保护会话一律保留",
        "· 若父会话下仍有已保护子会话，父会话会保留",
        "· 删除后文件体积需再点「压缩数据库」才会缩小",
      ].join("\n"),
    )
  }

  async function runBatch(action: "protect" | "unprotect" | "delete" | "vacuum", preview: boolean) {
    if (busy()) return
    setBusy(true)
    setMessage(null)
    try {
      const body: Record<string, unknown> = { action, preview }
      if (action !== "vacuum") {
        const ids = selectedIDs()
        if (ids.length === 0) {
          setMessage("请先选择会话")
          return
        }
        body.sessionIDs = ids
      }
      const res = await fetch(api("/session-storage/batch"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        setMessage(await readError(res, "操作失败"))
        return
      }
      const result = (await res.json()) as BatchResult
      setMessage(summarizeBatch(result, action))
      if (result.error || preview) return

      if (action === "delete") {
        const byId = new Map((scan()?.sessions ?? []).map((row) => [row.id, row]))
        const deleted = result.items
          .filter((item) => !item.skipped)
          .map((item) => {
            const row = byId.get(item.id)
            return { id: item.id, directory: row?.directory ?? "" }
          })
        props.onDeleted?.(deleted)
        setSelected({})
      }
      await loadState()
      if (action !== "vacuum") await runScan()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败")
    } finally {
      setBusy(false)
    }
  }

  const actionBar = () => (
    <div
      class={
        narrow()
          ? "flex flex-col gap-2 sticky bottom-0 z-10 -mx-1 px-1 py-2 bg-surface-primary border-t border-border-primary"
          : "flex flex-wrap gap-2 items-center"
      }
    >
      <div class="flex flex-wrap gap-2 items-center">
        <button class={btnOutline} onClick={() => toggleAll(true)}>
          全选(已加载筛选)
        </button>
        <button class={btnOutline} onClick={() => toggleAll(false)}>
          清空
        </button>
        <span class="text-12-regular text-text-weak">
          已选 {selectedIDs().length} · 约 {fmtBytes(selectedBytes())} · 筛选 {table().filtered.length}
        </span>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <button class={btnOutline} disabled={busy()} onClick={() => void runBatch("protect", true)}>
          预览保护
        </button>
        <button class={btnPrimary} disabled={busy()} onClick={() => void runBatch("protect", false)}>
          保护
        </button>
        <button class={btnSecondary} disabled={busy()} onClick={() => void runBatch("unprotect", false)}>
          取消保护
        </button>
        <button class={btnOutline} disabled={busy()} onClick={() => void runBatch("delete", true)}>
          预览删除
        </button>
        <button
          class={btnDanger}
          disabled={busy()}
          onClick={() => {
            if (!confirmDelete()) return
            void runBatch("delete", false)
          }}
        >
          删除
        </button>
        <button class={btnOutline} disabled={busy()} onClick={() => void runBatch("vacuum", true)}>
          预览压缩
        </button>
        <button
          class={btnSecondary}
          disabled={busy() || state()?.idle === false}
          onClick={() => {
            if (!confirm("确认执行 VACUUM 压缩数据库？")) return
            void runBatch("vacuum", false)
          }}
        >
          压缩数据库
        </button>
      </div>
    </div>
  )

  const pagination = () => (
    <div class="flex flex-wrap items-center gap-3 text-12-regular text-text-weak">
      <span>
        第 {table().page} / {table().pageCount} 页 · 每页 {PAGE_SIZE}
      </span>
      <button class={btnSecondary} disabled={table().page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
        上一页
      </button>
      <button
        class={btnSecondary}
        disabled={table().page >= table().pageCount}
        onClick={() => setPage((p) => p + 1)}
      >
        下一页
      </button>
    </div>
  )

  return (
    <div class="flex flex-col gap-4 p-4 h-full min-h-0 overflow-auto">
      <div class="flex flex-col gap-1">
        <div class="text-16-medium text-text-strong">会话存储管理</div>
        <div class="text-12-regular text-text-weak">
          手动扫描本地会话占用（估算含消息/部件/事件与子会话）。项目筛选与排序在本地完成。写操作需当前项目空闲。保护 =
          删除时保留该会话；清理父级时会删掉子树中未保护节点。
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button class={`${btnSecondary} text-13-medium`} disabled={stateLoading()} onClick={() => void loadState()}>
          {stateLoading() ? "读取中..." : "读取库状态"}
        </button>
        <Show when={state()}>
          {(s: () => StorageState) => (
            <div class="flex flex-col gap-1 text-13-regular min-w-0 flex-1">
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <span class="text-text-strong">
                  文件：<span class="font-mono">{fmtBytes(s().db_bytes)}</span>
                </span>
                <Show when={s().freelist_bytes != null}>
                  <span class="text-text-weak">
                    freelist：<span class="font-mono">{fmtBytes(s().freelist_bytes ?? 0)}</span>
                  </span>
                </Show>
                <span class={s().idle ? "text-text-info" : "text-text-danger"}>
                  {s().idle ? "空闲" : `有 ${s().active_session_count} 个会话在运行`}
                </span>
              </div>
              <Show when={s().side_bytes}>
                {(side) => (
                  <div class="text-12-regular text-text-weak flex flex-wrap gap-x-3">
                    <Show when={side()?.tool_output != null}>
                      <span>tool-output {fmtBytes(side()?.tool_output ?? 0)}</span>
                    </Show>
                    <Show when={side()?.snapshot != null}>
                      <span>snapshot {fmtBytes(side()?.snapshot ?? 0)}</span>
                    </Show>
                    <Show when={side()?.storage != null}>
                      <span>storage {fmtBytes(side()?.storage ?? 0)}</span>
                    </Show>
                  </div>
                )}
              </Show>
              <span class="text-text-weak font-mono text-12-regular truncate max-w-full" title={s().db_path}>
                {s().db_path}
              </span>
            </div>
          )}
        </Show>
      </div>
      <Show when={stateError()}>
        <div class="text-13-regular text-text-danger">{stateError()}</div>
      </Show>

      <div class="flex flex-wrap items-center gap-3">
        <label class="text-13-regular text-text-weak flex items-center gap-2">
          项目
          <select
            class="bg-surface-primary border border-border-primary rounded px-2 py-1 text-13-regular text-text-strong max-w-[min(100%,220px)]"
            value={projectFilter()}
            onChange={(e) => {
              setProjectFilter(e.currentTarget.value)
              setPage(1)
            }}
          >
            <option value="">全部</option>
            <For each={table().projects}>{(p) => <option value={p.id}>{p.label}</option>}</For>
          </select>
        </label>
        <label class="text-13-regular text-text-weak flex items-center gap-2">
          早于
          <input
            type="number"
            min={0}
            value={olderDays()}
            onInput={(e) => setOlderDays(Number(e.currentTarget.value) || 0)}
            class="w-16 bg-surface-primary border border-border-primary rounded px-2 py-1 text-13-regular text-text-strong"
          />
          天
        </label>
        <label class="text-13-regular text-text-weak flex items-center gap-2">
          扫描上限
          <input
            type="number"
            min={1}
            max={MAX_SCAN_LIMIT}
            value={scanLimit()}
            onInput={(e) => {
              const n = Number(e.currentTarget.value)
              setScanLimit(
                Number.isFinite(n) ? Math.min(MAX_SCAN_LIMIT, Math.max(1, Math.floor(n))) : DEFAULT_SCAN_LIMIT,
              )
            }}
            class="w-20 bg-surface-primary border border-border-primary rounded px-2 py-1 text-13-regular text-text-strong"
          />
        </label>
        <Show when={narrow()}>
          <label class="text-13-regular text-text-weak flex items-center gap-2">
            排序
            <select
              class="bg-surface-primary border border-border-primary rounded px-2 py-1 text-13-regular text-text-strong"
              value={sortKey()}
              onChange={(e) => onSort(e.currentTarget.value as SortKey)}
            >
              <For each={SORT_OPTIONS}>{(opt) => <option value={opt.key}>{opt.label}</option>}</For>
            </select>
            <button
              type="button"
              class={btnOutline}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              {sortDir() === "asc" ? "升序" : "降序"}
            </button>
          </label>
        </Show>
        <button class={`${btnPrimary} text-13-medium px-3`} disabled={scanning()} onClick={() => void runScan()}>
          {scanning() ? "扫描中..." : "扫描"}
        </button>
        <Show when={scan()}>
          {(s: () => ScanResult) => (
            <span class="text-13-regular text-text-weak">
              已加载 {s().session_count}
              {s().truncated ? ` / 匹配 ${s().total_matched}` : ""} · 约占用 {fmtBytes(s().total_approx_bytes)}
              {s().truncated ? " · 已截断" : ""}
            </span>
          )}
        </Show>
      </div>

      <Show when={scanError()}>
        <div class="text-13-regular text-text-danger">{scanError()}</div>
      </Show>

      <Show when={!scan() && !scanning() && !scanError()}>
        <div class="text-13-regular text-text-weak">点「扫描」加载会话列表（默认最多 {DEFAULT_SCAN_LIMIT} 条）。</div>
      </Show>

      <Show when={(scan()?.sessions.length ?? 0) > 0}>
        <Show when={!narrow()}>{actionBar()}</Show>

        <Show
          when={narrow()}
          fallback={
            <table class="w-full text-13-regular border-collapse">
              <thead>
                <tr class="border-b border-border-primary text-12-medium text-text-weak">
                  <th class="text-left py-2 px-2 w-8"></th>
                  <th
                    class="text-left py-2 px-2 cursor-pointer select-none hover:text-text-strong"
                    onClick={() => onSort("project_worktree")}
                  >
                    项目{sortMark("project_worktree", sortKey(), sortDir())}
                  </th>
                  <th
                    class="text-left py-2 px-2 cursor-pointer select-none hover:text-text-strong"
                    onClick={() => onSort("title")}
                  >
                    标题{sortMark("title", sortKey(), sortDir())}
                  </th>
                  <th
                    class="text-right py-2 px-2 cursor-pointer select-none hover:text-text-strong"
                    onClick={() => onSort("message_count")}
                  >
                    消息{sortMark("message_count", sortKey(), sortDir())}
                  </th>
                  <th
                    class="text-right py-2 px-2 cursor-pointer select-none hover:text-text-strong"
                    onClick={() => onSort("approx_bytes")}
                  >
                    约占用{sortMark("approx_bytes", sortKey(), sortDir())}
                  </th>
                  <th
                    class="text-left py-2 px-2 cursor-pointer select-none hover:text-text-strong"
                    onClick={() => onSort("time_updated")}
                  >
                    更新时间{sortMark("time_updated", sortKey(), sortDir())}
                  </th>
                  <th
                    class="text-left py-2 px-2 cursor-pointer select-none hover:text-text-strong"
                    onClick={() => onSort("protected")}
                  >
                    保护{sortMark("protected", sortKey(), sortDir())}
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={table().rows}>
                  {(row) => (
                    <tr class="border-b border-border-primary hover:bg-surface-secondary">
                      <td class="py-1.5 px-2">
                        <input type="checkbox" checked={!!selected()[row.id]} onChange={() => toggle(row.id)} />
                      </td>
                      <td
                        class="py-1.5 px-2 font-mono text-12-regular truncate max-w-[160px]"
                        title={projectTitle(row)}
                      >
                        {projectLabel(row)}
                      </td>
                      <td class="py-1.5 px-2 text-text-strong truncate max-w-[220px]" title={row.title}>
                        {row.title}
                        <Show when={(row.child_session_count ?? 0) > 0}>
                          <span class="text-12-regular text-text-weak ml-1">· 子{row.child_session_count}</span>
                        </Show>
                      </td>
                      <td class="py-1.5 px-2 text-right">{row.message_count}</td>
                      <td
                        class="py-1.5 px-2 text-right font-mono"
                        title={fmtBreakdown(row.breakdown) || "含事件与子会话（估算）"}
                      >
                        {fmtBytes(row.approx_bytes)}
                      </td>
                      <td class="py-1.5 px-2 text-12-regular text-text-weak">{fmtTime(row.time_updated)}</td>
                      <td class="py-1.5 px-2">{row.protected ? "是" : ""}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          }
        >
          <div class="flex flex-col gap-2">
            <For each={table().rows}>
              {(row) => (
                <label
                  class="flex gap-3 p-3 rounded border border-border-primary bg-surface-secondary/40 active:bg-surface-secondary cursor-pointer"
                  classList={{ "ring-1 ring-border-info": !!selected()[row.id] }}
                >
                  <input
                    type="checkbox"
                    class="mt-1 shrink-0"
                    checked={!!selected()[row.id]}
                    onChange={() => toggle(row.id)}
                  />
                  <div class="min-w-0 flex-1 flex flex-col gap-1">
                    <div class="flex items-start justify-between gap-2">
                      <div class="text-13-medium text-text-strong break-words">{row.title || "(无标题)"}</div>
                      <Show when={row.protected}>
                        <span class="shrink-0 text-11-medium px-1.5 py-0.5 rounded bg-surface-info/15 text-text-info">
                          保护
                        </span>
                      </Show>
                    </div>
                    <div class="text-12-regular text-text-weak font-mono truncate" title={projectTitle(row)}>
                      {projectLabel(row)}
                    </div>
                    <div class="text-12-regular text-text-weak flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>消息 {row.message_count}</span>
                      <span title={fmtBreakdown(row.breakdown) || undefined}>
                        约占用 {fmtBytes(row.approx_bytes)}
                      </span>
                      <Show when={(row.child_session_count ?? 0) > 0}>
                        <span>子会话 {row.child_session_count}</span>
                      </Show>
                      <span>{fmtTime(row.time_updated)}</span>
                    </div>
                    <Show when={row.breakdown}>
                      {(b) => <div class="text-11-regular text-text-weak">{fmtBreakdown(b())}</div>}
                    </Show>
                  </div>
                </label>
              )}
            </For>
          </div>
        </Show>

        {pagination()}
        <Show when={narrow()}>{actionBar()}</Show>
      </Show>

      <Show when={scan() && !scanning() && (scan()?.sessions.length ?? 0) === 0}>
        <div class="text-13-regular text-text-weak">暂无会话</div>
      </Show>

      <Show when={message()}>
        <div class="text-13-regular text-text-info border-t border-border-primary pt-3 whitespace-pre-wrap">
          {message()}
        </div>
      </Show>
    </div>
  )
}
