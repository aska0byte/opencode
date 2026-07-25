import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber } from "effect"
import { SidecarDiagnostics, type Details, type Probe, type Span } from "../../src/diagnostics/sidecar"

afterEach(() => {
  SidecarDiagnostics.clear()
})

function installProbe() {
  let active = 0
  let ends = 0
  let errors = 0
  const errorMessages: string[] = []

  const probe: Probe = {
    mark() {},
    begin(_name: string, _details?: Details): Span {
      active += 1
      return {
        end() {
          ends += 1
          active -= 1
        },
        error(message: string) {
          errors += 1
          errorMessages.push(message)
          active -= 1
        },
      }
    },
  }

  SidecarDiagnostics.install(probe)
  return {
    get active() {
      return active
    },
    get ends() {
      return ends
    },
    get errors() {
      return errors
    },
    errorMessages,
  }
}

describe("SidecarDiagnostics.span", () => {
  test("closes span on success", async () => {
    const probe = installProbe()

    const value = await Effect.runPromise(SidecarDiagnostics.span("ok", { sessionID: "ses" }, Effect.succeed(42)))

    expect(value).toBe(42)
    expect(probe.ends).toBe(1)
    expect(probe.errors).toBe(0)
    expect(probe.active).toBe(0)
  })

  test("closes span on failure", async () => {
    const probe = installProbe()

    const exit = await Effect.runPromiseExit(
      SidecarDiagnostics.span("fail", { sessionID: "ses" }, Effect.fail("boom" as const)),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    expect(probe.ends).toBe(0)
    expect(probe.errors).toBe(1)
    expect(probe.active).toBe(0)
    expect(probe.errorMessages.some((message) => message.includes("boom"))).toBe(true)
  })

  test("closes span on fiber interrupt (no zombie active span)", async () => {
    const probe = installProbe()

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(SidecarDiagnostics.span("hang", { sessionID: "ses" }, Effect.never))

        // Wait until begin() has registered the active span.
        while (probe.active === 0) yield* Effect.yieldNow

        yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit)).toBe(true)

        // Finalizers may settle after await in some schedulers; wait for cleanup.
        for (let i = 0; i < 100 && probe.active > 0; i++) {
          yield* Effect.yieldNow
        }
      }),
    )

    expect(probe.active).toBe(0)
    expect(probe.ends).toBe(0)
    expect(probe.errors).toBe(1)
  })

  test("passes through the effect when no probe is installed", async () => {
    SidecarDiagnostics.clear()
    const value = await Effect.runPromise(SidecarDiagnostics.span("noop", {}, Effect.succeed("raw")))
    expect(value).toBe("raw")
  })
})
