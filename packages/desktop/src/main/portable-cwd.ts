export function resolveStartupCwd(input: { instanceHome?: string; hostHome: string }) {
  if (input.instanceHome) return input.instanceHome
  return input.hostHome
}
