import { Cause, Effect, Exit } from "effect"

export type DetailValue = string | number | boolean | null
export type Details = Readonly<Record<string, DetailValue>>

export type Span = {
  readonly end: () => void
  readonly error: (message: string) => void
}

export type Probe = {
  readonly mark: (name: string, details?: Details) => void
  readonly begin: (name: string, details?: Details) => Span
}

declare global {
  var __opencodeSidecarPerfProbe: Probe | undefined
}

export function install(probe: Probe | undefined): void {
  globalThis.__opencodeSidecarPerfProbe = probe
}

export function clear(): void {
  globalThis.__opencodeSidecarPerfProbe = undefined
}

export function mark(name: string, details?: Details): void {
  globalThis.__opencodeSidecarPerfProbe?.mark(name, details)
}

export function span<A, E, R>(name: string, details: Details, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  const probe = globalThis.__opencodeSidecarPerfProbe
  if (!probe) return effect

  return Effect.gen(function* () {
    const active = probe.begin(name, details)
    const exit = yield* effect.pipe(Effect.exit)
    if (Exit.isSuccess(exit)) {
      active.end()
      return exit.value
    }

    active.error(Cause.pretty(exit.cause))
    return yield* Effect.failCause(exit.cause)
  })
}

export * as SidecarDiagnostics from "./sidecar"
