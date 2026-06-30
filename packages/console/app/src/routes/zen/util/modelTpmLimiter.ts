export function createModelTpmLimiter(_providers: {
  id: string
  model: string
  tpmLimit?: number
}[]):
  | {
      check: () => Promise<Record<string, number>>
      track: (_provider: string, _model: string, _usageInfo: unknown) => Promise<void>
    }
  | undefined {
  return undefined
}
