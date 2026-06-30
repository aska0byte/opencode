export function createRateLimiter(
  _modelId: string,
  _rateLimit: number | undefined,
  _rawIp: string,
  _request: Request,
): { check: () => Promise<void>; track: () => Promise<void> } | undefined {
  return undefined
}

export function getRetryAfterDay(now: number) {
  return Math.ceil((86_400_000 - (now % 86_400_000)) / 1000)
}
