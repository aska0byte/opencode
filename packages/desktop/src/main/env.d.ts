interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:opencode-server" {
  export namespace Server {
    export const listen: typeof import("../../../opencode/dist/types/src/node").Server.listen
    export type Listener = import("../../../opencode/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../opencode/dist/types/src/node").Config.get
    export type Info = import("../../../opencode/dist/types/src/node").Config.Info
  }
  export namespace SidecarDiagnostics {
    export const install: typeof import("../../../opencode/dist/types/src/node").SidecarDiagnostics.install
    export const clear: typeof import("../../../opencode/dist/types/src/node").SidecarDiagnostics.clear
  }
  export function setActivePortableInstance(configPath: string | undefined): void
  export const bootstrap: typeof import("../../../opencode/dist/types/src/node").bootstrap
}
