// 魔改版：完全禁用自动更新检查（upgrade 保留空实现，不触发任何网络请求或通知）。
// shouldNotify 保持与上游 v1.19.0 一致，供 test/cli/upgrade.test.ts 使用。
export function shouldNotify(input: {
  autoupdate: boolean | "notify" | undefined
  disabled: boolean
  always: boolean
  current: string
  latest: string
}) {
  if (input.autoupdate === false || input.disabled) return false
  if (input.always) return true
  return input.current !== input.latest
}

export async function upgrade() {
  // 空实现：不检查更新，不触发任何通知
  return undefined
}
