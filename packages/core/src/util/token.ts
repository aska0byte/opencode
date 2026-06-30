export * as Token from "./token"

export const estimate = (input: string) => {
  let sum = 0
  for (const char of input) {
    const code = char.codePointAt(0)!
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) {
      sum += 2.5
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      sum += 0.27
    } else if (code >= 0x30 && code <= 0x39) {
      sum += 0.3
    } else if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      sum += 0.15
    } else {
      sum += 0.3
    }
  }
  return Math.round(sum)
}
