#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import { Script } from "@opencode-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()

  // Write JSON sidecar with base64-encoded file data
  fs.mkdirSync(path.join(dir, "dist/node"), { recursive: true })
  const data: Record<string, string> = {}
  for (const file of files) {
    const content = await Bun.file(path.join(dist, file)).arrayBuffer()
    data[file] = Buffer.from(content).toString("base64")
  }
  const jsonPath = path.join(dir, "dist/node/opencode-web-ui.json")
  await Bun.write(jsonPath, JSON.stringify(data))
  console.log(`  Wrote ${files.length} files to ${jsonPath}`)

  return jsonPath
}

if (!skipEmbedWebUi) await createEmbeddedWebUIBundle()

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    OPENCODE_MODELS_DEV: generated.modelsData,
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
  },
})

console.log("Build complete")
