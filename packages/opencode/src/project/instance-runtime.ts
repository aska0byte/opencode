import { AppRuntime } from "@/effect/app-runtime"
import { type InstanceContext } from "./instance-context"
import { InstanceStore, type LoadInput } from "./instance-store"

// Bridge for Promise/ALS callers that cannot yet yield InstanceStore.Service.
// Delete this module once those callers are migrated to Effect boundaries that
// provide InstanceStore directly.

function trace(action: string, input: { directory?: string; worktree?: string; projectID?: string }) {
  console.log(`[opencode:dcp-init-trace] InstanceRuntime.${action}`, {
    pid: process.pid,
    ppid: process.ppid,
    directory: input.directory,
    worktree: input.worktree,
    projectID: input.projectID,
  })
}

export const load = (input: LoadInput) => {
  trace("load", { directory: input.directory, worktree: input.worktree, projectID: input.project?.id })
  return AppRuntime.runPromise(InstanceStore.Service.use((store) => store.load(input)))
}
export const disposeInstance = (ctx: InstanceContext) => {
  trace("disposeInstance", { directory: ctx.directory, worktree: ctx.worktree, projectID: ctx.project.id })
  return AppRuntime.runPromise(InstanceStore.Service.use((store) => store.dispose(ctx)))
}
export const disposeAllInstances = () => {
  trace("disposeAllInstances", {})
  return AppRuntime.runPromise(InstanceStore.Service.use((store) => store.disposeAll()))
}
export const reloadInstance = (input: LoadInput) => {
  trace("reloadInstance", { directory: input.directory, worktree: input.worktree, projectID: input.project?.id })
  return AppRuntime.runPromise(InstanceStore.Service.use((store) => store.reload(input)))
}

export * as InstanceRuntime from "./instance-runtime"
