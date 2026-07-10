import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadSidecarDiagnosticsConfig } from "./sidecar-diagnostics-config"

const roots: string[] = []

afterEach(async () => {
  const pending = roots.splice(0)
  await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true })))
})

describe("loadSidecarDiagnosticsConfig", () => {
  test("keeps diagnostics disabled when config omits the field", async () => {
    const root = await tempConfigHome()
    await writeFile(join(root, "opencode.json"), `{ "permission": { "external_directory": "ask" } }`)

    const config = loadSidecarDiagnosticsConfig({ log: () => {}, configHome: root })

    expect(config.enabled).toBe(false)
    expect(config.dump).toBe(false)
    expect(config.probe).toBe(false)
  })

  test("parses JSONC diagnostics sidecar options", async () => {
    const root = await tempConfigHome()
    await writeFile(
      join(root, "opencode.json"),
      `{
        // Given diagnostics are explicitly enabled for a freeze investigation.
        "diagnostics": {
          "enabled": true,
          "sidecar": {
            "dump": true,
            "probe": true,
            "slow_threshold_ms": 2500,
            "dump_min_interval_ms": 45000,
            "report_lag_threshold_ms": 12000,
          },
        },
      }`,
    )

    const config = loadSidecarDiagnosticsConfig({ log: () => {}, configHome: root })

    expect(config).toEqual({
      enabled: true,
      dump: true,
      probe: true,
      slowThresholdMs: 2500,
      dumpMinIntervalMs: 45000,
      reportLagThresholdMs: 12000,
    })
  })
})

async function tempConfigHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "opencode-sidecar-config-"))
  roots.push(root)
  return root
}
