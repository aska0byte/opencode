import { Cause, Effect, Exit } from "effect"

export type DetailValue = string | number | boolean | null
export type Details = Readonly<Record<string, DetailValue>>

export type Span = {
  readonly end: () => void
  readonly error: (message: string) => void
  readonly setDetails?: (details: Details) => void
}

export type Probe = {
  readonly mark: (name: string, details?: Details) => void
  readonly begin: (name: string, details?: Details) => Span
  readonly patchActiveByCallID?: (callID: string, patch: Details) => void
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

/** Update in-flight Tool.execute (etc.) active span details by callID. */
export function patchActiveByCallID(callID: string, patch: Details): void {
  globalThis.__opencodeSidecarPerfProbe?.patchActiveByCallID?.(callID, patch)
}

/**
 * Wrap an Effect with a probe span that always closes on success, failure, defect,
 * or interruption. Do not use `yield* effect.pipe(Effect.exit)` then end the span
 * afterward: outer Fiber.interrupt skips that continuation and leaks active spans.
 */
export function span<A, E, R>(name: string, details: Details, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
  const probe = globalThis.__opencodeSidecarPerfProbe
  if (!probe) return effect

  return Effect.suspend(() => {
    const active = probe.begin(name, details)
    return effect.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit)) {
            active.end()
            return
          }
          active.error(Cause.pretty(exit.cause))
        }),
      ),
    )
  })
}

export * as SidecarDiagnostics from "./sidecar"
