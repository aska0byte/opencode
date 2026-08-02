/** Canonical todo statuses used by UI + incomplete counting. */
export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const
export type TodoStatus = (typeof TODO_STATUSES)[number]

const TODO_PRIORITIES = ["high", "medium", "low"] as const
export type TodoPriority = (typeof TODO_PRIORITIES)[number]

/** Map common model typos to canonical statuses so lists can be closed. */
export function normalizeTodoStatus(status: string): TodoStatus {
  const s = status.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (["completed", "complete", "done", "finished", "fixed", "closed"].includes(s)) return "completed"
  if (["cancelled", "canceled", "skipped", "abandoned", "wontfix", "obsolete"].includes(s)) return "cancelled"
  if (["in_progress", "inprogress", "doing", "active", "working"].includes(s)) return "in_progress"
  if (["pending", "todo", "open", "queued", "ready"].includes(s)) return "pending"
  if ((TODO_STATUSES as readonly string[]).includes(s)) return s as TodoStatus
  return "pending"
}

export function normalizeTodoPriority(priority: string): TodoPriority {
  const p = priority.trim().toLowerCase()
  if ((TODO_PRIORITIES as readonly string[]).includes(p)) return p as TodoPriority
  if (p === "urgent" || p === "critical") return "high"
  if (p === "normal" || p === "default") return "medium"
  return "medium"
}

export function normalizeTodoItem<T extends { content: string; status: string; priority: string }>(todo: T): T {
  return {
    ...todo,
    content: todo.content.trim() || todo.content,
    status: normalizeTodoStatus(todo.status),
    priority: normalizeTodoPriority(todo.priority),
  }
}

/** After user abort: freeze in-flight items so the list is not stuck forever. */
export function cancelInProgressTodos<T extends { status: string }>(todos: ReadonlyArray<T>): T[] {
  return todos.map((todo) =>
    normalizeTodoStatus(todo.status) === "in_progress" ? { ...todo, status: "cancelled" as const } : todo,
  )
}

export function todosChanged<T extends { content: string; status: string; priority: string }>(
  before: ReadonlyArray<T>,
  after: ReadonlyArray<T>,
): boolean {
  if (before.length !== after.length) return true
  for (let i = 0; i < before.length; i++) {
    const a = before[i]
    const b = after[i]
    if (!a || !b) return true
    if (a.content !== b.content || a.status !== b.status || a.priority !== b.priority) return true
  }
  return false
}
