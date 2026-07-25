import { Component, For, Show, createResource, createSignal, createMemo, onMount } from "solid-js"

type SortField = "call_count" | "total_input" | "cache_ratio" | "total_output" | "model_id" | "project_worktree"
type SortDir = "asc" | "desc"

type Row = {
  date: string
  project_id: string
  /** Display label (already resolved server-side). */
  project_worktree: string
  project_path?: string
  model_id: string
  call_count: number
  tokens_in: number
  tokens_out: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
}

type DailyRow = {
  date: string
  call_count: number
  tokens_in: number
  tokens_out: number
  tokens_reasoning: number
  tokens_cache_read: number
  tokens_cache_write: number
}

type RangeOption = { label: string; value: number | null; isHour?: boolean }
const RANGES: RangeOption[] = [
  { label: "1小时", value: 1, isHour: true },
  { label: "24小时", value: 1 },
  { label: "7天", value: 7 },
  { label: "30天", value: 30 },
  { label: "自定义", value: null },
]

function todayStr() {
  return new Date().toLocaleDateString("en-CA")
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toString()
}

/** Prefer server-resolved label; never show blank when project_id exists. */
function showProject(row: Row): string {
  const label = row.project_worktree?.trim()
  if (label) return label
  if (row.project_id) return row.project_id.slice(0, 12)
  return "（无项目）"
}

function projectTitle(row: Row): string {
  return row.project_path?.trim() || showProject(row)
}

export const UsageStatsTab: Component<{ serverUrl?: string }> = (props) => {
  const [date, setDate] = createSignal(todayStr())
  const [range, setRange] = createSignal(1)
  const [customMode, setCustomMode] = createSignal(false)
  const [hourMode, setHourMode] = createSignal(false)
  const [sortField, setSortField] = createSignal<SortField>("call_count")
  const [sortDir, setSortDir] = createSignal<SortDir>("desc")
  const [cleanupDays, setCleanupDays] = createSignal(90)
  const [cleanupResult, setCleanupResult] = createSignal<string | null>(null)

  function api(path: string) {
    const base = props.serverUrl ?? ""
    return base + path
  }

  const [stats, { refetch }] = createResource(
    () => ({ custom: customMode(), hour: hourMode(), d: date(), r: range() }),
    async (key) => {
      if (key.custom || key.hour) {
        const res = await fetch(api(`/usage-stats/daily?date=${key.d}`))
        if (!res.ok) throw new Error("Failed to fetch")
        return (await res.json()) as Row[]
      }
      const res = await fetch(api(`/usage-stats/range?range=${key.r}`))
      if (!res.ok) throw new Error("Failed to fetch")
      return (await res.json()) as Row[]
    },
  )

  const [dailyStats, { refetch: refetchDaily }] = createResource(
    () => ({ custom: customMode(), hour: hourMode(), r: range() }),
    async (key) => {
      if (key.custom || key.hour) return [] as DailyRow[]
      const res = await fetch(api(`/usage-stats/daily-range?range=${key.r}`))
      if (!res.ok) throw new Error("Failed to fetch")
      return (await res.json()) as DailyRow[]
    },
  )

  // 跨天检测：组件挂载时同步日期并刷新数据
  onMount(() => {
    setDate(todayStr())
    refetch()
    refetchDaily()
  })

  const sorted = createMemo(() => {
    const data = stats()
    if (!data) return []
    const field = sortField()
    const dir = sortDir()
    return [...data].sort((a, b) => {
      let va: number | string, vb: number | string
      switch (field) {
        case "total_input":
          va = a.tokens_in; vb = b.tokens_in; break
        case "total_output":
          va = a.tokens_out + a.tokens_reasoning; vb = b.tokens_out + b.tokens_reasoning; break
        case "cache_ratio":
          va = a.tokens_in > 0 ? a.tokens_cache_read / a.tokens_in : 0
          vb = b.tokens_in > 0 ? b.tokens_cache_read / b.tokens_in : 0
          break
        default:
          va = a[field] as (number | string); vb = b[field] as (number | string); break
      }
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return dir === "asc" ? cmp : -cmp
    })
  })

  const total = createMemo(() => {
    const data = stats()
    if (!data) return null
    const totalInput = data.reduce((s, r) => s + r.tokens_in, 0)
    const totalCacheRead = data.reduce((s, r) => s + r.tokens_cache_read, 0)
    return {
      call_count: data.reduce((s, r) => s + r.call_count, 0),
      total_input: totalInput,
      total_output: data.reduce((s, r) => s + r.tokens_out + r.tokens_reasoning, 0),
      cache_ratio: totalInput > 0 ? (totalCacheRead / totalInput * 100) : 0,
    }
  })

  function toggleSort(field: SortField) {
    if (sortField() === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      setSortDir("desc")
    }
  }

  function sortArrow(field: SortField): string {
    if (sortField() !== field) return ""
    return sortDir() === "asc" ? " ▲" : " ▼"
  }

  function isActive(opt: RangeOption): boolean {
    if (opt.value === null) return customMode()
    if (opt.isHour) return hourMode()
    return !customMode() && !hourMode() && range() === opt.value
  }

  function selectRange(opt: RangeOption) {
    setHourMode(!!opt.isHour)
    if (opt.value === null) {
      setCustomMode(true)
    } else {
      setCustomMode(false)
      setRange(opt.value!)
    }
  }

  async function handleCleanup() {
    const days = cleanupDays()
    const res = await fetch(api("/usage-stats/cleanup"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep_days: days }),
    })
    if (!res.ok) {
      setCleanupResult("清理失败")
      return
    }
    const data = await res.json()
    setCleanupResult(`已清理 ${data.deleted} 条记录（保留 ${days} 天）`)
    refetch()
  }

  return (
    <div class="flex flex-col h-full gap-4 p-4 overflow-auto">
      {/* Time range selector */}
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={RANGES}>
          {(opt) => (
            <button
              onClick={() => selectRange(opt)}
              class={`px-3 py-1 text-13-medium rounded ${
                isActive(opt)
                  ? "bg-[var(--v2-background-bg-accent)] text-[var(--v2-text-text-inverse)]"
                  : "bg-surface-secondary text-text-strong hover:bg-surface-tertiary"
              }`}
            >
              {opt.label}
            </button>
          )}
        </For>
        <Show when={customMode()}>
          <input
            type="date"
            value={date()}
            onInput={(e) => setDate(e.currentTarget.value)}
            class="bg-surface-primary border border-border-primary rounded px-2 py-1 text-13-regular text-text-strong"
          />
        </Show>
      </div>

      <Show when={stats.loading && sorted().length === 0}>
        <div class="text-13-regular text-text-weak">加载中...</div>
      </Show>

      <Show when={stats.error}>
        <div class="text-13-regular text-text-danger">加载失败</div>
      </Show>

      <Show when={sorted().length > 0}>
        <table class="w-full text-13-regular border-collapse">
          <thead>
            <tr class="border-b border-border-primary text-12-medium text-text-weak">
              <th class="text-left py-2 px-2 cursor-pointer select-none hover:text-text-strong" onClick={() => toggleSort("project_worktree")}>
                项目{sortArrow("project_worktree")}
              </th>
              <th class="text-left py-2 px-2 cursor-pointer select-none hover:text-text-strong" onClick={() => toggleSort("model_id")}>
                模型{sortArrow("model_id")}
              </th>
              <th class="text-right py-2 px-2 cursor-pointer select-none hover:text-text-strong" onClick={() => toggleSort("call_count")}>
                调用次数{sortArrow("call_count")}
              </th>
              <th class="text-right py-2 px-2 cursor-pointer select-none hover:text-text-strong" onClick={() => toggleSort("total_input")}>
                总输入{sortArrow("total_input")}
              </th>
              <th class="text-right py-2 px-2 cursor-pointer select-none hover:text-text-strong" onClick={() => toggleSort("cache_ratio")}>
                缓存占比{sortArrow("cache_ratio")}
              </th>
              <th class="text-right py-2 px-2 cursor-pointer select-none hover:text-text-strong" onClick={() => toggleSort("total_output")}>
                总输出{sortArrow("total_output")}
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={sorted()}>
              {(row) => (
                <tr class="border-b border-border-primary hover:bg-surface-secondary">
                  <td class="py-1.5 px-2 font-mono text-12-regular text-text-strong truncate max-w-[200px]" title={projectTitle(row)}>{showProject(row)}</td>
                  <td class="py-1.5 px-2 text-text-strong">{row.model_id}</td>
                  <td class="py-1.5 px-2 text-right text-text-strong">{fmt(row.call_count)}</td>
                  <td class="py-1.5 px-2 text-right text-text-strong" title={`输入: ${fmt(row.tokens_in - row.tokens_cache_read - row.tokens_cache_write)}\n缓存读取: ${fmt(row.tokens_cache_read)}\n缓存写入: ${fmt(row.tokens_cache_write)}`}>
                    {fmtCompact(row.tokens_in)}
                  </td>
                  <td class="py-1.5 px-2 text-right text-text-strong" title={`缓存占比 ${row.tokens_in > 0 ? (row.tokens_cache_read / row.tokens_in * 100).toFixed(1) : 0}%`}>
                    {row.tokens_in > 0 ? (row.tokens_cache_read / row.tokens_in * 100).toFixed(1) + "%" : "0%"}
                  </td>
                  <td class="py-1.5 px-2 text-right text-text-strong" title={`输出: ${fmt(row.tokens_out)}\n推理: ${fmt(row.tokens_reasoning)}`}>
                    {fmtCompact(row.tokens_out + row.tokens_reasoning)}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-border-primary text-13-medium text-text-strong">
              <td class="py-2 px-2" colSpan={2}>总计</td>
              <td class="py-2 px-2 text-right">{fmt(total()?.call_count ?? 0)}</td>
              <td class="py-2 px-2 text-right">{fmtCompact(total()?.total_input ?? 0)}</td>
              <td class="py-2 px-2 text-right">{total()?.cache_ratio.toFixed(1) ?? "0"}%</td>
              <td class="py-2 px-2 text-right">{fmtCompact(total()?.total_output ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </Show>

      <Show when={!stats.loading && !stats.error && sorted().length === 0}>
        <div class="text-13-regular text-text-weak">暂无调用记录</div>
      </Show>

      <Show when={dailyStats() && dailyStats()!.length > 0}>
        <div class="text-12-medium text-text-weak mb-1">按日明细</div>
        <table class="w-full text-13-regular border-collapse">
          <thead>
            <tr class="border-b border-border-primary text-12-medium text-text-weak">
              <th class="text-left py-2 px-2">日期</th>
              <th class="text-right py-2 px-2">调用次数</th>
              <th class="text-right py-2 px-2">总输入</th>
              <th class="text-right py-2 px-2">缓存占比</th>
              <th class="text-right py-2 px-2">总输出</th>
            </tr>
          </thead>
          <tbody>
            <For each={dailyStats()}>
              {(row) => (
                <tr class="border-b border-border-primary hover:bg-surface-secondary">
                  <td class="py-1.5 px-2 text-text-strong">{row.date}</td>
                  <td class="py-1.5 px-2 text-right text-text-strong">{fmt(row.call_count)}</td>
                  <td class="py-1.5 px-2 text-right text-text-strong" title={`输入: ${fmt(row.tokens_in - row.tokens_cache_read - row.tokens_cache_write)}\n缓存读取: ${fmt(row.tokens_cache_read)}\n缓存写入: ${fmt(row.tokens_cache_write)}`}>
                    {fmtCompact(row.tokens_in)}
                  </td>
                  <td class="py-1.5 px-2 text-right text-text-strong">
                    {row.tokens_in > 0 ? (row.tokens_cache_read / row.tokens_in * 100).toFixed(1) + "%" : "0%"}
                  </td>
                  <td class="py-1.5 px-2 text-right text-text-strong" title={`输出: ${fmt(row.tokens_out)}\n推理: ${fmt(row.tokens_reasoning)}`}>
                    {fmtCompact(row.tokens_out + row.tokens_reasoning)}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>

      <div class="border-t border-border-primary pt-4 mt-auto">
        <div class="flex items-center gap-3">
          <span class="text-13-medium text-text-strong">清理历史数据</span>
          <input
            type="number"
            value={cleanupDays()}
            onInput={(e) => setCleanupDays(Number(e.currentTarget.value))}
            min={1}
            class="w-20 bg-surface-primary border border-border-primary rounded px-2 py-1 text-13-regular text-text-strong"
          />
          <span class="text-13-regular text-text-weak">天以前的记录</span>
          <button
            onClick={handleCleanup}
            class="bg-surface-danger text-white text-13-medium px-3 py-1 rounded hover:opacity-90"
          >
            清理
          </button>
          <Show when={cleanupResult()}>
            <span class="text-13-regular text-text-info">{cleanupResult()}</span>
          </Show>
        </div>
      </div>
    </div>
  )
}
