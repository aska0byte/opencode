/** Last non-empty path segment; empty for root-ish paths like `/` or `C:/`. */
export function pathLeaf(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean)
  if (parts.length === 0) return ""
  const last = parts[parts.length - 1] ?? ""
  if (parts.length === 1 && /^[A-Za-z]:$/.test(last)) return ""
  return last
}

export function isRootPath(path: string): boolean {
  const n = path.replace(/\\/g, "/").trim()
  if (!n || n === "/") return true
  return /^[A-Za-z]:\/?$/.test(n)
}

/**
 * Human label for usage-stats "项目" column.
 * Prefer session/project directory basename (same as session-storage), then worktree, name, id.
 */
export function projectLabel(row: {
  readonly directory?: string
  readonly project_worktree?: string
  readonly project_name?: string
  readonly project_id: string
}): string {
  const dirLeaf = pathLeaf(row.directory ?? "")
  if (dirLeaf) return dirLeaf
  const worktree = row.project_worktree ?? ""
  if (worktree && !isRootPath(worktree)) {
    const leaf = pathLeaf(worktree)
    if (leaf) return leaf
  }
  const name = row.project_name?.trim()
  if (name) return name
  if (row.project_id) return row.project_id.slice(0, 12)
  return "（无项目）"
}

/** Best full path for tooltip (directory → worktree → empty). */
export function projectPathHint(row: {
  readonly directory?: string
  readonly project_worktree?: string
}): string {
  const directory = (row.directory ?? "").trim()
  if (directory && !isRootPath(directory)) return directory
  const worktree = (row.project_worktree ?? "").trim()
  if (worktree) return worktree
  return directory
}
