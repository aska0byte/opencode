export function createTrialLimiter(
  _trialProviders: string[] | undefined,
  _ip: string,
): { check: () => Promise<string[] | undefined>; track: (_usageInfo: unknown) => Promise<void> } | undefined {
  return undefined
}
