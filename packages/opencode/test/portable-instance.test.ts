import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  applyInstanceEnvironment,
  ensureInstanceLayout,
  loadInstanceConfigFile,
  parseInstanceConfig,
  parseInstanceDirArg,
  resolveInstanceLayout,
  resolveInstanceServer,
  resolveProductConfigPath,
  writeInstanceServerConfig,
  DEFAULT_SERVER,
  PortableInstanceError,
} from "../src/portable-instance"

const roots: string[] = []

afterEach(async () => {
  const pending = roots.splice(0)
  await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-portable-"))
  roots.push(root)
  return root
}

describe("parseInstanceDirArg", () => {
  test("parses --instance_dir value", () => {
    const dir = parseInstanceDirArg(["--instance_dir", "D:\\inst\\a"], "C:\\cwd")
    expect(dir).toBe(path.resolve("C:\\cwd", "D:\\inst\\a"))
  })

  test("parses --instance_dir=value", () => {
    const dir = parseInstanceDirArg(["--instance_dir=./data"], "/tmp/work")
    expect(dir).toBe(path.resolve("/tmp/work", "./data"))
  })

  test("returns undefined when flag missing", () => {
    expect(parseInstanceDirArg(["--port", "1"])).toBeUndefined()
  })

  test("throws when flag has no value", () => {
    expect(() => parseInstanceDirArg(["--instance_dir"])).toThrow(PortableInstanceError)
  })
})

describe("parseInstanceConfig", () => {
  test("accepts empty object", () => {
    expect(parseInstanceConfig({})).toEqual({})
  })

  test("rejects non-object", () => {
    expect(() => parseInstanceConfig([])).toThrow(PortableInstanceError)
  })

  test("rejects invalid listen_global", () => {
    expect(() => parseInstanceConfig({ server: { listen_global: 2 } })).toThrow(PortableInstanceError)
  })

  test("accepts partial server", () => {
    expect(parseInstanceConfig({ server: { port: 5000, listen_global: 0 } })).toEqual({
      server: { port: 5000, listen_global: 0 },
    })
  })
})

describe("resolveInstanceServer", () => {
  test("defaults to 4096 and opencode/opencode with global listen", () => {
    expect(resolveInstanceServer({})).toEqual({
      listen_global: DEFAULT_SERVER.listen_global,
      port: DEFAULT_SERVER.port,
      username: DEFAULT_SERVER.username,
      password: DEFAULT_SERVER.password,
      hostname: "0.0.0.0",
    })
  })

  test("maps listen_global 0 to 127.0.0.1", () => {
    expect(resolveInstanceServer({ server: { listen_global: 0 } }).hostname).toBe("127.0.0.1")
  })
})

describe("layout and env", () => {
  test("builds fixed USER_DATA and APP_DATA layout", async () => {
    const root = await tempRoot()
    const layout = resolveInstanceLayout(root)
    ensureInstanceLayout(layout)

    expect(layout.userData).toBe(path.join(root, "USER_DATA"))
    expect(layout.coreData).toBe(path.join(root, "APP_DATA", "data", "opencode"))
    expect(layout.dumps).toBe(path.join(root, "APP_DATA", "state", "diagnostics", "sidecar-dumps"))
    expect(layout.dbPath).toBe(path.join(layout.coreData, "opencode.db"))
  })

  test("applyInstanceEnvironment overwrites host env", async () => {
    const root = await tempRoot()
    const layout = resolveInstanceLayout(root)
    ensureInstanceLayout(layout)
    const env: NodeJS.ProcessEnv = {
      XDG_DATA_HOME: "C:\\host\\share",
      APPDATA: "C:\\host\\appdata",
      HOME: "C:\\Users\\host",
      OPENCODE_CONFIG: "C:\\host\\opencode.json",
    }
    const product = resolveProductConfigPath(layout, { config: "opencode.json" })
    applyInstanceEnvironment({ layout, productConfigPath: product, env })

    expect(env.XDG_DATA_HOME).toBe(layout.xdgDataHome)
    expect(env.APPDATA).toBe(layout.xdgConfigHome)
    expect(env.HOME).toBe(layout.home)
    expect(env.USERPROFILE).toBe(layout.home)
    expect(env.OPENCODE_CONFIG).toBe(product)
    expect(env.OPENCODE_CONFIG_DIR).toBe(path.dirname(product))
    expect(env.OPENCODE_DB).toBe(layout.dbPath)
    expect(env.TMP).toBe(layout.tmp)
  })
})

describe("instance.config persistence", () => {
  test("load missing file returns empty", async () => {
    const root = await tempRoot()
    const layout = resolveInstanceLayout(root)
    expect(loadInstanceConfigFile(layout.configPath)).toEqual({})
  })

  test("writeInstanceServerConfig preserves config path field", async () => {
    const root = await tempRoot()
    const layout = resolveInstanceLayout(root)
    ensureInstanceLayout(layout)
    await writeFile(layout.configPath, JSON.stringify({ config: "./opencode.json", server: { port: 1 } }, null, 2))

    const written = writeInstanceServerConfig(layout.configPath, {
      listen_global: 0,
      port: 5555,
      username: "u",
      password: "p",
    })

    expect(written).toEqual({
      listen_global: 0,
      port: 5555,
      username: "u",
      password: "p",
    })
    const disk = JSON.parse(await readFile(layout.configPath, "utf8")) as {
      config: string
      server: { port: number; listen_global: number }
    }
    expect(disk.config).toBe("./opencode.json")
    expect(disk.server.port).toBe(5555)
    expect(disk.server.listen_global).toBe(0)
  })
})
