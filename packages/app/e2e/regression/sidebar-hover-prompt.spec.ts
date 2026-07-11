import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const primaryDirectory = "C:/OpenCode/SidebarHoverPrompt"
const secondaryDirectory = "C:/OpenCode/SidebarHoverPromptOther"
const primaryProjectID = "proj_sidebar_hover_prompt"
const secondaryProjectID = "proj_sidebar_hover_prompt_other"
const sessionID = "ses_sidebar_hover_prompt"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ viewport: { width: 1440, height: 900 } })

test("keeps project hover preview stable without moving the prompt cursor", async ({ page }) => {
  // Given: two projects in an open sidebar and a focused prompt with text.
  await mockOpenCodeServer(page, {
    directory: primaryDirectory,
    project: project(primaryProjectID, primaryDirectory, "sidebar-hover-prompt"),
    projects: [
      project(primaryProjectID, primaryDirectory, "sidebar-hover-prompt"),
      project(secondaryProjectID, secondaryDirectory, "sidebar-hover-prompt-other"),
    ],
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "sidebar-hover-prompt",
        projectID: primaryProjectID,
        directory: primaryDirectory,
        title: "Sidebar hover prompt",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await seedProjectStore(page)
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, "Sidebar hover prompt")
  await page.getByRole("button", { name: "Toggle sidebar" }).click()

  const prompt = page.locator('[data-component="prompt-input"]')
  await prompt.click()
  await page.keyboard.type("abcdef")
  await expect(prompt).toHaveText("abcdef")
  await expect.poll(() => setPromptCursor(page, 3)).toBe(true)

  const projectTrigger = page
    .locator('[data-component="sidebar-nav-desktop"]')
    .locator(`[data-action="project-switch"][data-project="${base64Encode(secondaryDirectory)}"]`)
  await expect(projectTrigger).toBeVisible()

  // When: the pointer repeatedly crosses the project trigger and preview edge.
  for (const offset of [4, 8, 12, 16, 20, 24]) {
    await projectTrigger.hover({ position: { x: 20, y: offset } })
    await page.mouse.move(92, 180 + offset)
  }
  await projectTrigger.hover()
  await expect(page.locator('[data-component="hover-card-content"]')).toBeVisible()

  await page.keyboard.type("Z")

  // Then: the hover preview remains usable and the prompt cursor resumes where the user left it.
  await expect(prompt).toHaveText("abcZdef")
})

function project(id: string, worktree: string, name: string) {
  return {
    id,
    worktree,
    vcs: "git",
    name,
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

async function setPromptCursor(page: Page, offset: number) {
  return page.evaluate((cursorOffset) => {
    const editor = document.querySelector('[data-component="prompt-input"]')
    if (!(editor instanceof HTMLElement)) return false
    const textNode = editor.firstChild
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false
    const selection = window.getSelection()
    if (!selection) return false
    const range = document.createRange()
    range.setStart(textNode, cursorOffset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  }, offset)
}

async function seedProjectStore(page: Page) {
  await page.addInitScript(
    (input) => {
      const projects = [
        { worktree: input.primaryDirectory, expanded: true },
        { worktree: input.secondaryDirectory, expanded: true },
      ]
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          list: [],
          projects: { local: projects, [input.server]: projects },
          lastProject: { local: input.primaryDirectory, [input.server]: input.primaryDirectory },
          recentlyClosed: {},
        }),
      )
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: false } }))
    },
    { primaryDirectory, secondaryDirectory, server },
  )
}
