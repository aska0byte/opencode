export function isPortableUpdaterDisabled(instanceDir?: string) {
  return Boolean(instanceDir || process.env.OPENCODE_INSTANCE_DIR)
}
