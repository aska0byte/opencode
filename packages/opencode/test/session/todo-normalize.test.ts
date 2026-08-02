import { describe, expect, test } from "bun:test"
import {
  cancelInProgressTodos,
  normalizeTodoItem,
  normalizeTodoStatus,
  todosChanged,
} from "../../src/session/todo-normalize"

describe("normalizeTodoStatus", () => {
  test("maps done/finished to completed", () => {
    expect(normalizeTodoStatus("done")).toBe("completed")
    expect(normalizeTodoStatus("Finished")).toBe("completed")
  })

  test("maps canceled to cancelled", () => {
    expect(normalizeTodoStatus("canceled")).toBe("cancelled")
    expect(normalizeTodoStatus("skipped")).toBe("cancelled")
  })

  test("unknown falls back to pending", () => {
    expect(normalizeTodoStatus("weird")).toBe("pending")
  })
})

describe("normalizeTodoItem", () => {
  test("normalizes status and priority", () => {
    expect(
      normalizeTodoItem({ content: " x ", status: "done", priority: "urgent" }),
    ).toEqual({ content: "x", status: "completed", priority: "high" })
  })
})

describe("cancelInProgressTodos", () => {
  test("only cancels in_progress", () => {
    const next = cancelInProgressTodos([
      { content: "a", status: "pending", priority: "medium" },
      { content: "b", status: "in_progress", priority: "high" },
      { content: "c", status: "completed", priority: "low" },
    ])
    expect(next.map((t) => t.status)).toEqual(["pending", "cancelled", "completed"])
  })
})

describe("todosChanged", () => {
  test("detects status change", () => {
    const a = [{ content: "a", status: "pending", priority: "medium" }]
    const b = [{ content: "a", status: "cancelled", priority: "medium" }]
    expect(todosChanged(a, b)).toBe(true)
    expect(todosChanged(a, a)).toBe(false)
  })
})
