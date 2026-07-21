import { describe, expect, mock, test } from "bun:test"

import { pluginServiceStatusSchema, type PluginServiceSummary } from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { PluginServiceHost, type PluginServiceToolRuntime } from "./plugin-service-host"
import {
  pluginServiceBrowserAuthorizationCompletionSchema,
  pluginServiceBrowserAuthorizationRequestSchema,
  type PluginServiceBrowserAuthorizationCompletion,
} from "./plugin-service-browser-authorization"

const summary: PluginServiceSummary = {
  actions: ["sign_out"],
  capabilities: [],
  description: "Account connection",
  models: [],
  pluginId: "account-tools",
  pluginName: "Account Tools",
  version: "1.0.0",
}

const status = {
  account: { availability: "unavailable" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "unavailable" },
  schema: pluginServiceStatusSchema,
  state: "connected",
  usage: { availability: "unavailable" },
} as const

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe("PluginServiceHost", () => {
  test("returns only a validated structured status and ignores raw MCP text", async () => {
    const callService = mock(async () => ({
      content: [{ text: "Bearer secret-must-not-cross-preload", type: "text" }],
      structuredContent: status,
    }))
    const runtime: PluginServiceToolRuntime = {
      callService,
      listServices: async () => [summary],
    }
    const host = new PluginServiceHost(runtime)

    expect(await host.getStatus("account-tools")).toEqual(status)
    expect(callService).toHaveBeenCalledWith("account-tools", "status", undefined)
    expect(JSON.stringify(await host.getStatus("account-tools"))).not.toContain("secret-must-not-cross-preload")
  })

  test("maps host methods to fixed actions and never accepts an action payload", async () => {
    const calls: Array<{ call: "status" | WebPluginServiceAction; pluginId: string }> = []
    const runtime: PluginServiceToolRuntime = {
      async callService(pluginId, call) {
        calls.push({ call, pluginId })
        return { structuredContent: status }
      },
      listServices: async () => [summary],
    }
    const host = new PluginServiceHost(runtime)

    await host.signOut("account-tools")
    expect(calls).toEqual([{ call: "sign_out", pluginId: "account-tools" }])
  })

  test("keeps the browser request and cookies in main and completes through one fixed continuation", async () => {
    const authorizationSummary: PluginServiceSummary = {
      ...summary,
      actions: ["authorize", "reauthorize", "authorization.cancel", "sign_out"],
    }
    const request = {
      authorization_id: "request_0123456789abcdef",
      cookie_names: ["session_id"],
      cookie_origin: "https://accounts.example.com",
      login_url: "https://accounts.example.com/sign-in",
      schema: pluginServiceBrowserAuthorizationRequestSchema,
    }
    const completions: PluginServiceBrowserAuthorizationCompletion[] = []
    const runtime: PluginServiceToolRuntime = {
      async callService(_pluginId, call) {
        expect(call).toBe("authorize")
        return {
          completeAuthorization: async (input) => {
            completions.push(input)
            return { structuredContent: status }
          },
          isError: false,
          structuredContent: request,
        }
      },
      listServices: async () => [authorizationSummary],
    }
    const browserCalls: unknown[] = []
    const checkpointCommits: string[] = []
    const host = new PluginServiceHost(runtime, {
      async authorize(pluginId, parsed, options) {
        browserCalls.push({ action: options.action, pluginId, parsed, serviceIdentity: options.serviceIdentity })
        expect(await options.isCurrent()).toBeTrue()
        return {
          authorization_id: parsed.authorizationId,
          cookie_origin: parsed.cookieOrigin,
          cookies: [{ name: "session_id", value: "main-only-cookie" }],
          schema: pluginServiceBrowserAuthorizationCompletionSchema,
        }
      },
      async commitPlugin(pluginId) {
        checkpointCommits.push(pluginId)
      },
      async disposePlugin() {},
    })

    const result = await host.authorize("account-tools")
    expect(result).toEqual(status)
    expect(browserCalls).toEqual([
      expect.objectContaining({
        action: "authorize",
        pluginId: "account-tools",
        serviceIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ])
    expect(checkpointCommits).toEqual(["account-tools"])
    expect(completions).toEqual([
      {
        authorization_id: "request_0123456789abcdef",
        cookie_origin: "https://accounts.example.com",
        cookies: [{ name: "session_id", value: "main-only-cookie" }],
        schema: pluginServiceBrowserAuthorizationCompletionSchema,
      },
    ])
    expect(JSON.stringify(result)).not.toContain("main-only-cookie")
  })

  test("fails closed before opening a browser for an invalid request", async () => {
    let browserCalls = 0
    const calls: WebPluginServiceAction[] = []
    const host = new PluginServiceHost(
      {
        callService: async (_pluginId, call) => {
          if (call === "status") throw new Error("unexpected status call")
          calls.push(call)
          if (call === "authorization.cancel") return { structuredContent: status }
          return {
            completeAuthorization: async () => ({ structuredContent: status }),
            structuredContent: {
              authorization_id: "request_0123456789abcdef",
              cookie_names: ["session_id"],
              cookie_origin: "https://accounts.example.com",
              login_url: "https://phishing.example/sign-in",
              schema: pluginServiceBrowserAuthorizationRequestSchema,
            },
          }
        },
        listServices: async () => [{ ...summary, actions: ["authorize", "authorization.cancel"] }],
      },
      {
        async authorize() {
          browserCalls += 1
          throw new Error("must not run")
        },
        async disposePlugin() {},
      },
    )

    await expect(host.authorize("account-tools")).rejects.toThrow("invalid browser authorization request")
    expect(browserCalls).toBe(0)
    expect(calls).toEqual(["authorize", "authorization.cancel"])
  })

  test("cancels a failed browser request so authorization can be retried immediately", async () => {
    const authorizationSummary: PluginServiceSummary = {
      ...summary,
      actions: ["authorize", "authorization.cancel"],
    }
    const request = {
      authorization_id: "request_0123456789abcdef",
      cookie_names: ["session_id"],
      cookie_origin: "https://accounts.example.com",
      login_url: "https://accounts.example.com/sign-in",
      schema: pluginServiceBrowserAuthorizationRequestSchema,
    }
    const calls: WebPluginServiceAction[] = []
    let pending = false
    const runtime: PluginServiceToolRuntime = {
      async callService(_pluginId, call) {
        if (call === "status") throw new Error("unexpected status call")
        calls.push(call)
        if (call === "authorization.cancel") {
          pending = false
          return { structuredContent: status }
        }
        if (pending) return { isError: true }
        pending = true
        return {
          completeAuthorization: async () => {
            pending = false
            return { structuredContent: status }
          },
          structuredContent: request,
        }
      },
      listServices: async () => [authorizationSummary],
    }
    let browserAttempts = 0
    const host = new PluginServiceHost(runtime, {
      async authorize(_pluginId, parsed) {
        browserAttempts += 1
        if (browserAttempts === 1) throw new Error("Authorization window failed")
        return {
          authorization_id: parsed.authorizationId,
          cookie_origin: parsed.cookieOrigin,
          cookies: [{ name: "session_id", value: "main-only-cookie" }],
          schema: pluginServiceBrowserAuthorizationCompletionSchema,
        }
      },
      async disposePlugin() {},
    })

    await expect(host.authorize("account-tools")).rejects.toThrow("Authorization window failed")
    expect(pending).toBeFalse()
    expect(await host.authorize("account-tools")).toEqual(status)
    expect(calls).toEqual(["authorize", "authorization.cancel", "authorize"])
  })

  test("clears sidecar authorization when completion fails without replacing that failure", async () => {
    const authorizationSummary: PluginServiceSummary = {
      ...summary,
      actions: ["authorize", "authorization.cancel"],
    }
    const calls: WebPluginServiceAction[] = []
    const host = new PluginServiceHost(
      {
        async callService(_pluginId, call) {
          if (call === "status") throw new Error("unexpected status call")
          calls.push(call)
          if (call === "authorization.cancel") throw new Error("cleanup failed")
          return {
            completeAuthorization: async () => ({ isError: true }),
            structuredContent: {
              authorization_id: "request_0123456789abcdef",
              cookie_names: ["session_id"],
              cookie_origin: "https://accounts.example.com",
              login_url: "https://accounts.example.com/sign-in",
              schema: pluginServiceBrowserAuthorizationRequestSchema,
            },
          }
        },
        listServices: async () => [authorizationSummary],
      },
      {
        async authorize(_pluginId, parsed) {
          return {
            authorization_id: parsed.authorizationId,
            cookie_origin: parsed.cookieOrigin,
            cookies: [{ name: "session_id", value: "main-only-cookie" }],
            schema: pluginServiceBrowserAuthorizationCompletionSchema,
          }
        },
        async disposePlugin() {},
      },
    )

    await expect(host.authorize("account-tools")).rejects.toThrow("authorization completion failed: account-tools")
    expect(calls).toEqual(["authorize", "authorization.cancel"])
  })

  test("clears an active host browser session before sign-out", async () => {
    const calls: string[] = []
    const host = new PluginServiceHost(
      {
        async callService(_pluginId, call) {
          calls.push(call)
          return { structuredContent: status }
        },
        listServices: async () => [summary],
      },
      {
        async authorize() {
          throw new Error("unused")
        },
        async clearPlugin(pluginId) {
          calls.push(`clear:${pluginId}`)
        },
        async disposePlugin(pluginId) {
          calls.push(`dispose:${pluginId}`)
        },
      },
    )

    await host.signOut("account-tools")
    expect(calls).toEqual(["dispose:account-tools", "clear:account-tools", "sign_out"])
  })

  test("blocks a new authorization throughout checkpoint clearing and sign-out", async () => {
    const cleared = deferred<void>()
    const calls: string[] = []
    const host = new PluginServiceHost(
      {
        async callService(_pluginId, call) {
          calls.push(call)
          return { structuredContent: status }
        },
        listServices: async () => [{ ...summary, actions: ["authorize", "sign_out"] }],
      },
      {
        async authorize() {
          throw new Error("must not open during sign-out")
        },
        async clearPlugin(pluginId) {
          calls.push(`clear:${pluginId}`)
          await cleared.promise
        },
        async disposePlugin(pluginId) {
          calls.push(`dispose:${pluginId}`)
        },
      },
    )

    const signingOut = host.signOut("account-tools")
    await Promise.resolve()
    await expect(host.authorize("account-tools")).rejects.toThrow("control action is active")
    cleared.resolve(undefined)
    expect(await signingOut).toEqual(status)
    expect(calls).toEqual(["dispose:account-tools", "clear:account-tools", "sign_out"])
  })

  test("status refresh never commits an unrelated in-flight authorization checkpoint", async () => {
    const calls: string[] = []
    const host = new PluginServiceHost(
      {
        async callService() {
          return { structuredContent: status }
        },
        listServices: async () => [summary],
      },
      {
        async authorize() {
          throw new Error("unused")
        },
        async commitPlugin(pluginId) {
          calls.push(`commit:${pluginId}`)
        },
        async disposePlugin() {},
      },
    )

    expect(await host.getStatus("account-tools")).toEqual(status)
    expect(calls).toEqual([])
  })

  test("app disposal aborts and drains an in-flight service control call", async () => {
    const started = deferred<void>()
    const host = new PluginServiceHost(
      {
        async callService(_pluginId, call, signal) {
          if (call !== "sign_out") throw new Error("unexpected call")
          started.resolve(undefined)
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
          })
        },
        listServices: async () => [summary],
      },
      {
        async authorize() {
          throw new Error("unused")
        },
        async clearPlugin() {},
        async disposePlugin() {},
      },
    )

    const signingOut = host.signOut("account-tools")
    await started.promise
    await host.dispose()
    await expect(signingOut).rejects.toMatchObject({ name: "AbortError" })
  })

  test("keeps a captured checkpoint when sidecar completion fails", async () => {
    const checkpointCalls: string[] = []
    const host = new PluginServiceHost(
      {
        async callService(_pluginId, call) {
          if (call === "authorization.cancel") return { structuredContent: status }
          return {
            authorizationIdentity: "a".repeat(64),
            completeAuthorization: async () => {
              throw new Error("sidecar restarted before commit")
            },
            structuredContent: {
              authorization_id: "request_0123456789abcdef",
              cookie_names: ["session_id"],
              cookie_origin: "https://accounts.example.com",
              login_url: "https://accounts.example.com/sign-in",
              schema: pluginServiceBrowserAuthorizationRequestSchema,
            },
          }
        },
        listServices: async () => [{ ...summary, actions: ["authorize", "authorization.cancel"] }],
      },
      {
        async authorize(_pluginId, parsed) {
          checkpointCalls.push("captured")
          return {
            authorization_id: parsed.authorizationId,
            cookie_origin: parsed.cookieOrigin,
            cookies: [{ name: "session_id", value: "main-only-cookie" }],
            schema: pluginServiceBrowserAuthorizationCompletionSchema,
          }
        },
        async clearPlugin() {
          checkpointCalls.push("cleared")
        },
        async commitPlugin() {
          checkpointCalls.push("committed")
        },
        async disposePlugin() {},
      },
    )

    await expect(host.authorize("account-tools")).rejects.toThrow("sidecar restarted before commit")
    expect(checkpointCalls).toEqual(["captured"])
  })

  test("fails closed for sidecar errors or invalid structured output without copying diagnostics", async () => {
    const failed = new PluginServiceHost({
      callService: async () => ({ isError: true, structuredContent: status }),
      listServices: async () => [summary],
    })
    await expect(failed.getStatus("account-tools")).rejects.toThrow("status failed: account-tools")

    const invalid = new PluginServiceHost({
      callService: async () => ({ structuredContent: { ...status, accessKey: "do-not-return" } }),
      listServices: async () => [summary],
    })
    await expect(invalid.getStatus("account-tools")).rejects.toThrow("invalid bounded status: account-tools")
  })

  test("discards a completed result if the Plugin is updated or uninstalled during the call", async () => {
    const result = deferred<{ structuredContent: typeof status }>()
    let installed: readonly PluginServiceSummary[] = [summary]
    const host = new PluginServiceHost({
      callService: async () => result.promise,
      listServices: async () => installed,
    })
    const pending = host.getStatus("account-tools")
    await Promise.resolve()
    installed = []
    result.resolve({ structuredContent: status })
    await expect(pending).rejects.toThrow("changed while the request was running")
  })
})
