export function createModelTpsLimiter(_providers: {
  id: string
  model: string
  tpsGoal?: number
}[]):
  | {
      check: () => Promise<Record<string, { qualify: number; unqualify: number }>>
      track: (
        _provider: string,
        _model: string,
        _tpsGoal: number | undefined,
        _tsFirstByte: number,
        _tsLastByte: number,
        _usageInfo: unknown,
      ) => Promise<void>
    }
  | undefined {
  return undefined
}
