import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  getActivePortableInstance,
  resolveLocalServerConfig,
  setActivePortableInstance,
  writeLocalServerConfig,
} from "../src/server/local-server-config"
import { ensureInstanceLayout, resolveInstanceLayout } from "../src/portable-instance"

const roots: string[] = []

afterEach(async () => {
  setActivePortableInstance(undefined)
  const pending = roots.splice(0)
  await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-lsc-"))
  roots.push(root)
  return root
}

describe("local-server-config portable instance", () => {
  test("resolve reads instance.config defaults when active", async () => {
    const root = await tempRoot()
    const layout = resolveInstanceLayout(root)
    ensureInstanceLayout(layout)
    setActivePortableInstance(layout.configPath)

    expect(getActivePortableInstance()).toBe(layout.configPath)
    expect(resolveLocalServerConfig({})).toEqual({
      port: 4096,
      listen: "global",
      username: "opencode",
      password: "opencode",
    })
  })

  test("write updates instance.config.server and preserves config path", async () => {
    const root = await tempRoot()
    const layout = resolveInstanceLayout(root)
    ensureInstanceLayout(layout)
    await writeFile(layout.configPath, JSON.stringify({ config: "./opencode.json" }, null, 2))
    setActivePortableInstance(layout.configPath)

    const written = await writeLocalServerConfig({
      port: 5123,
      listen: "local",
      username: "alice",
      password: "secret",
    })

    expect(written).toEqual({
      port: 5123,
      listen: "local",
      username: "alice",
      password: "secret",
    })
    const disk = JSON.parse(await readFile(layout.configPath, "utf8")) as {
      config: string
      server: { listen_global: number; port: number; username: string; password: string }
    }
    expect(disk.config).toBe("./opencode.json")
    expect(disk.server).toEqual({
      listen_global: 0,
      port: 5123,
      username: "alice",
      password: "secret",
    })
    expect(resolveLocalServerConfig({})).toEqual(written)
  })
})
