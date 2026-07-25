import { describe, expect, test } from "bun:test"
import {
  DEFAULT_LOCAL_SERVER_CONFIG,
  hostnameForListen,
  parseLocalServerConfig,
  persistLocalServerConfig,
  resolveLocalServerConfig,
} from "./local-server-config"

function memoryStore(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  return {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value
    },
    data,
  }
}

describe("local-server-config", () => {
  test("resolve uses defaults when store and env empty", () => {
    // given
    const store = memoryStore()

    // when
    const config = resolveLocalServerConfig(store, {})

    // then
    expect(config).toEqual(DEFAULT_LOCAL_SERVER_CONFIG)
    expect(hostnameForListen(config.listen)).toBe("0.0.0.0")
  })

  test("resolve prefers store over env", () => {
    // given
    const store = memoryStore({
      serverPort: 5000,
      serverListen: "local",
      serverUsername: "alice",
      serverPassword: "secret",
    })

    // when
    const config = resolveLocalServerConfig(store, {
      OPENCODE_PORT: "4096",
      OPENCODE_SERVER_HOSTNAME: "0.0.0.0",
      OPENCODE_SERVER_USERNAME: "bob",
      OPENCODE_SERVER_PASSWORD: "other",
    })

    // then
    expect(config).toEqual({
      port: 5000,
      listen: "local",
      username: "alice",
      password: "secret",
    })
    expect(hostnameForListen(config.listen)).toBe("127.0.0.1")
  })

  test("resolve falls back to env when store empty", () => {
    // given
    const store = memoryStore()

    // when
    const config = resolveLocalServerConfig(store, {
      OPENCODE_PORT: "4123",
      OPENCODE_SERVER_HOSTNAME: "127.0.0.1",
      OPENCODE_SERVER_USERNAME: "env-user",
      OPENCODE_SERVER_PASSWORD: "env-pass",
    })

    // then
    expect(config).toEqual({
      port: 4123,
      listen: "local",
      username: "env-user",
      password: "env-pass",
    })
  })

  test("parse rejects invalid port", () => {
    // given / when / then
    expect(() =>
      parseLocalServerConfig({
        port: 0,
        listen: "global",
        username: "opencode",
        password: "x",
      }),
    ).toThrow("invalid port")
  })

  test("persist writes store keys", () => {
    // given
    const store = memoryStore()

    // when
    const saved = persistLocalServerConfig(store, {
      port: 4097,
      listen: "local",
      username: "opencode",
      password: "opencode",
    })

    // then
    expect(saved.port).toBe(4097)
    expect(store.data.serverPort).toBe(4097)
    expect(store.data.serverListen).toBe("local")
    expect(store.data.serverUsername).toBe("opencode")
    expect(store.data.serverPassword).toBe("opencode")
  })
})
