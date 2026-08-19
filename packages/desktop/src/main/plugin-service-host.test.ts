import { describe, expect, mock, spyOn, test } from "bun:test"

import {
  pluginServiceStatusSchema,
  pluginServiceUsageSchema,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { PluginServiceHost, type PluginServiceToolRuntime } from "./plugin-service-host"
import {
  pluginServiceBrowserAuthorizationCompletionSchema,
  pluginServiceBrowserAuthorizationRequestSchema,
  type PluginServiceBrowserAuthorizationCompletion,
} from "./plugin-service-browser-authorization"
import {
  pluginServiceExternalAuthorizationCompletionSchema,
  pluginServiceExternalAuthorizationRequestSchema,
  type PluginServiceExternalAuthorizationCompletion,
} from "./plugin-service-external-authorization"

const summary: PluginServiceSummary = {
  actions: ["sign_out"],
  capabilities: [],
  description: "Account connection",
  llmProviderIds: [],
  models: [],
  pluginId: "account-tools",
  pluginName: "Account Tools",
  serviceId: "account-tools",
  version: "1.0.0",
}

const target = { pluginId: "account-tools", serviceId: "account-tools" } as const

const status = {
  account: { availability: "unavailable" },
  billing: { availability: "unavailable" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "unavailable" },
  plan: { availability: "unavailable" },
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
  test("opens only the fixed Checkout result and returns the refreshed bounded status", async () => {
    const checkoutSummary = { ...summary, actions: ["checkout", "sign_out"] as WebPluginServiceAction[] }
    const calls: Array<{ call: string; input?: { readonly planKey: string } }> = []
    const runtime: PluginServiceToolRuntime = {
      async callService(_pluginId, call, _signal, input) {
        calls.push({ call, ...(input === undefined ? {} : { input }) })
        return call === "checkout"
          ? {
              structuredContent: {
                checkout_id: "checkout_12345678",
                checkout_url: "https://checkout.example.test/session/123?provider=secure",
                schema: "convax.plugin-service-checkout/1",
              },
            }
          : { structuredContent: status }
      },
      listServices: async () => [checkoutSummary],
    }
    const opened: string[] = []
    const onServiceMutation = mock(async () => undefined)
    const host = new PluginServiceHost(
      runtime,
      undefined,
      undefined,
      {
        open: async (url) => {
          opened.push(url)
        },
      },
      onServiceMutation,
    )

    expect(await host.checkout(target, "pro")).toEqual(status)
    expect(calls).toEqual([{ call: "checkout", input: { planKey: "pro" } }, { call: "status" }])
    expect(opened).toEqual(["https://checkout.example.test/session/123?provider=secure"])
    expect(onServiceMutation).toHaveBeenCalledTimes(1)
  })

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

    expect(await host.getStatus(target)).toEqual(status)
    expect(callService).toHaveBeenCalledWith(target, "status", undefined)
    expect(JSON.stringify(await host.getStatus(target))).not.toContain("secret-must-not-cross-preload")
  })

  test("returns bounded usage records and degrades an optional tool failure", async () => {
    let available = true
    const host = new PluginServiceHost({
      async callService(_pluginId, call) {
        if (call !== "usage") return { structuredContent: status }
        return available
          ? {
              structuredContent: {
                availability: "available",
                records: [{ amount: 7 }, { amount: 3 }],
                schema: pluginServiceUsageSchema,
                unit: "credits",
              },
            }
          : { isError: true }
      },
      listServices: async () => [summary],
    })

    await expect(host.getUsageHistory(target)).resolves.toMatchObject({
      records: [{ amount: 7 }, { amount: 3 }],
    })
    available = false
    await expect(host.getUsageHistory(target)).resolves.toEqual({
      availability: "unavailable",
      schema: pluginServiceUsageSchema,
    })
  })

  test("maps host methods to fixed actions and never accepts an action payload", async () => {
    const calls: Array<{
      call: "status" | "usage" | WebPluginServiceAction
      target: { pluginId: string; serviceId: string }
    }> = []
    const onServiceMutation = mock(async () => undefined)
    const runtime: PluginServiceToolRuntime = {
      async callService(requestedTarget, call) {
        calls.push({ call, target: requestedTarget })
        return { structuredContent: status }
      },
      listServices: async () => [summary],
    }
    const host = new PluginServiceHost(runtime, undefined, undefined, undefined, onServiceMutation)

    await host.getStatus(target)
    await host.signOut(target)
    expect(calls).toEqual([
      { call: "status", target },
      { call: "sign_out", target },
    ])
    expect(onServiceMutation).toHaveBeenCalledTimes(1)
  })

  test("does not report a completed service mutation as failed when Agent refresh fails", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    const host = new PluginServiceHost(
      {
        callService: async () => ({ structuredContent: status }),
        listServices: async () => [summary],
      },
      undefined,
      undefined,
      undefined,
      async () => {
        throw new Error("Agent refresh failed")
      },
    )

    await expect(host.signOut(target)).resolves.toEqual(status)
    await Promise.resolve()
    expect(warning).toHaveBeenCalledTimes(1)
    warning.mockRestore()
  })

  test("refreshes host projections after a potentially mutating service call fails", async () => {
    const onServiceMutation = mock(async () => undefined)
    const host = new PluginServiceHost(
      {
        callService: async () => {
          throw new Error("response was lost after the service changed")
        },
        listServices: async () => [summary],
      },
      undefined,
      undefined,
      undefined,
      onServiceMutation,
    )

    await expect(host.signOut(target)).rejects.toThrow("response was lost")
    expect(onServiceMutation).toHaveBeenCalledTimes(1)
  })

  test("does not delay a completed service mutation while Agent refresh is busy", async () => {
    const refresh = deferred<void>()
    const onServiceMutation = mock(() => refresh.promise)
    const host = new PluginServiceHost(
      {
        callService: async () => ({ structuredContent: status }),
        listServices: async () => [summary],
      },
      undefined,
      undefined,
      undefined,
      onServiceMutation,
    )

    await expect(host.signOut(target)).resolves.toEqual(status)
    expect(onServiceMutation).toHaveBeenCalledTimes(1)
    refresh.resolve()
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
          snapshotDigest: "b".repeat(64),
          completeAuthorization: async (input) => {
            if (!("cookies" in input)) throw new Error("unexpected external authorization completion")
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
    const checkpointCommits: Array<{ pluginId: string; serviceId: string }> = []
    const host = new PluginServiceHost(runtime, {
      async authorize(requestedTarget, parsed, options) {
        browserCalls.push({
          action: options.action,
          parsed,
          serviceIdentity: options.serviceIdentity,
          snapshotDigest: options.snapshotDigest,
          target: requestedTarget,
        })
        expect(await options.isCurrent()).toBeTrue()
        return {
          authorization_id: parsed.authorizationId,
          cookie_origin: parsed.cookieOrigin,
          cookies: [{ name: "session_id", value: "main-only-cookie" }],
          schema: pluginServiceBrowserAuthorizationCompletionSchema,
        }
      },
      async commitPlugin(requestedTarget) {
        checkpointCommits.push(requestedTarget)
      },
      async disposePlugin() {},
    })

    const result = await host.authorize(target)
    expect(result).toEqual(status)
    expect(browserCalls).toEqual([
      expect.objectContaining({
        action: "authorize",
        serviceIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
        snapshotDigest: "b".repeat(64),
        target,
      }),
    ])
    expect(checkpointCommits).toEqual([target])
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

  test("opens public-client authorization externally and completes without exposing a code or token", async () => {
    const authorizationSummary: PluginServiceSummary = {
      ...summary,
      actions: ["authorize", "authorization.cancel", "sign_out"],
    }
    const completions: PluginServiceExternalAuthorizationCompletion[] = []
    const runtime: PluginServiceToolRuntime = {
      async callService(_pluginId, call) {
        if (call === "authorization.cancel") return { structuredContent: status }
        return {
          completeAuthorization: async (input) => {
            if ("cookies" in input) throw new Error("unexpected browser-cookie completion")
            completions.push(input)
            return { structuredContent: status }
          },
          structuredContent: {
            authorization_id: "request_0123456789abcdef",
            authorization_url:
              "https://nexus.microvoid.io/workspace/convax/auth/sign-in?state=state&code_challenge=challenge",
            schema: pluginServiceExternalAuthorizationRequestSchema,
          },
        }
      },
      listServices: async () => [authorizationSummary],
    }
    const opened: string[] = []
    const completed = mock(() => undefined)
    const host = new PluginServiceHost(
      runtime,
      undefined,
      {
        async authorize(_pluginId, request) {
          opened.push(request.authorizationUrl)
          return {
            authorization_id: request.authorizationId,
            schema: pluginServiceExternalAuthorizationCompletionSchema,
          }
        },
        async disposePlugin() {},
      },
      undefined,
      undefined,
      completed,
    )

    expect(await host.authorize(target)).toEqual(status)
    expect(completed).toHaveBeenCalledTimes(1)
    expect(opened).toEqual([
      "https://nexus.microvoid.io/workspace/convax/auth/sign-in?state=state&code_challenge=challenge",
    ])
    expect(completions).toEqual([
      {
        authorization_id: "request_0123456789abcdef",
        schema: pluginServiceExternalAuthorizationCompletionSchema,
      },
    ])
  })

  test("does not focus Convax when external authorization completion fails", async () => {
    const authorizationSummary: PluginServiceSummary = {
      ...summary,
      actions: ["authorize", "authorization.cancel"],
    }
    const focused = mock(() => undefined)
    const host = new PluginServiceHost(
      {
        async callService(_pluginId, call) {
          if (call === "authorization.cancel") return { structuredContent: status }
          return {
            completeAuthorization: async () => ({ isError: true }),
            structuredContent: {
              authorization_id: "request_0123456789abcdef",
              authorization_url:
                "https://nexus.microvoid.io/workspace/convax/auth/sign-in?state=state&code_challenge=challenge",
              schema: pluginServiceExternalAuthorizationRequestSchema,
            },
          }
        },
        listServices: async () => [authorizationSummary],
      },
      undefined,
      {
        async authorize(_pluginId, request) {
          return {
            authorization_id: request.authorizationId,
            schema: pluginServiceExternalAuthorizationCompletionSchema,
          }
        },
        async disposePlugin() {},
      },
      undefined,
      undefined,
      focused,
    )

    await expect(host.authorize(target)).rejects.toThrow("authorization completion failed")
    expect(focused).not.toHaveBeenCalled()
  })

  test("fails closed before opening a browser for an invalid request", async () => {
    let browserCalls = 0
    const calls: WebPluginServiceAction[] = []
    const host = new PluginServiceHost(
      {
        callService: async (_pluginId, call) => {
          if (call === "status" || call === "usage") throw new Error("unexpected read call")
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

    await expect(host.authorize(target)).rejects.toThrow("invalid browser authorization request")
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
        if (call === "status" || call === "usage") throw new Error("unexpected read call")
        calls.push(call)
        if (call === "authorization.cancel") {
          pending = false
          return { structuredContent: status }
        }
        if (pending) return { isError: true }
        pending = true
        return {
          snapshotDigest: "b".repeat(64),
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

    await expect(host.authorize(target)).rejects.toThrow("Authorization window failed")
    expect(pending).toBeFalse()
    expect(await host.authorize(target)).toEqual(status)
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
          if (call === "status" || call === "usage") throw new Error("unexpected read call")
          calls.push(call)
          if (call === "authorization.cancel") throw new Error("cleanup failed")
          return {
            snapshotDigest: "b".repeat(64),
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

    await expect(host.authorize(target)).rejects.toThrow("authorization completion failed: account-tools")
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
        async clearPlugin(requestedTarget) {
          calls.push(`clear:${requestedTarget.pluginId}/${requestedTarget.serviceId}`)
        },
        async disposePlugin(requestedTarget) {
          calls.push(`dispose:${requestedTarget.pluginId}/${requestedTarget.serviceId}`)
        },
      },
    )

    await host.signOut(target)
    expect(calls).toEqual(["dispose:account-tools/account-tools", "clear:account-tools/account-tools", "sign_out"])
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
        async clearPlugin(requestedTarget) {
          calls.push(`clear:${requestedTarget.pluginId}/${requestedTarget.serviceId}`)
          await cleared.promise
        },
        async disposePlugin(requestedTarget) {
          calls.push(`dispose:${requestedTarget.pluginId}/${requestedTarget.serviceId}`)
        },
      },
    )

    const signingOut = host.signOut(target)
    await Promise.resolve()
    await expect(host.authorize(target)).rejects.toThrow("control action is active")
    cleared.resolve(undefined)
    expect(await signingOut).toEqual(status)
    expect(calls).toEqual(["dispose:account-tools/account-tools", "clear:account-tools/account-tools", "sign_out"])
  })

  test("does not let one service control action block a sibling service from the same Plugin", async () => {
    const imageTarget = { pluginId: "multi-tools", serviceId: "image-generation" } as const
    const videoTarget = { pluginId: "multi-tools", serviceId: "video-generation" } as const
    const clearStarted = deferred<void>()
    const releaseClear = deferred<void>()
    const calls: string[] = []
    const services: PluginServiceSummary[] = [imageTarget, videoTarget].map((serviceTarget) => ({
      ...summary,
      actions: ["authorize", "sign_out"],
      pluginId: serviceTarget.pluginId,
      serviceId: serviceTarget.serviceId,
    }))
    const host = new PluginServiceHost(
      {
        async callService(requestedTarget, call) {
          calls.push(`${requestedTarget.serviceId}:${call}`)
          return { structuredContent: status }
        },
        listServices: async () => services,
      },
      {
        async authorize() {
          throw new Error("direct status authorization does not open a browser")
        },
        async clearPlugin(requestedTarget) {
          if (requestedTarget.serviceId !== imageTarget.serviceId) return
          clearStarted.resolve(undefined)
          await releaseClear.promise
        },
        async disposePlugin() {},
      },
    )

    const signingOut = host.signOut(imageTarget)
    await clearStarted.promise
    await expect(host.authorize(videoTarget)).resolves.toEqual(status)
    releaseClear.resolve(undefined)
    await expect(signingOut).resolves.toEqual(status)
    expect(calls).toEqual(["video-generation:authorize", "image-generation:sign_out"])
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
        async commitPlugin(requestedTarget) {
          calls.push(`commit:${requestedTarget.pluginId}/${requestedTarget.serviceId}`)
        },
        async disposePlugin() {},
      },
    )

    expect(await host.getStatus(target)).toEqual(status)
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

    const signingOut = host.signOut(target)
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
            snapshotDigest: "b".repeat(64),
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

    await expect(host.authorize(target)).rejects.toThrow("sidecar restarted before commit")
    expect(checkpointCalls).toEqual(["captured"])
  })

  test("fails closed for sidecar errors or invalid structured output without copying diagnostics", async () => {
    const failed = new PluginServiceHost({
      callService: async () => ({ isError: true, structuredContent: status }),
      listServices: async () => [summary],
    })
    await expect(failed.getStatus(target)).rejects.toThrow("status failed: account-tools")

    const invalid = new PluginServiceHost({
      callService: async () => ({ structuredContent: { ...status, accessKey: "do-not-return" } }),
      listServices: async () => [summary],
    })
    await expect(invalid.getStatus(target)).rejects.toThrow("invalid bounded status: account-tools")
  })

  test("discards a completed result if the Plugin is updated or uninstalled during the call", async () => {
    const result = deferred<{ structuredContent: typeof status }>()
    let installed: readonly PluginServiceSummary[] = [summary]
    const host = new PluginServiceHost({
      callService: async () => result.promise,
      listServices: async () => installed,
    })
    const pending = host.getStatus(target)
    await Promise.resolve()
    installed = []
    result.resolve({ structuredContent: status })
    await expect(pending).rejects.toThrow("changed while the request was running")
  })

  test("discards a status result if the same-version service model projection changes", async () => {
    const result = deferred<{ structuredContent: typeof status }>()
    let installed: readonly PluginServiceSummary[] = [summary]
    const host = new PluginServiceHost({
      callService: async () => result.promise,
      listServices: async () => installed,
    })
    const pending = host.getStatus(target)
    await Promise.resolve()
    installed = [
      {
        ...summary,
        capabilities: ["image"],
        models: [{ capability: "image", id: "generate.image", name: "Image Model" }],
      },
    ]
    result.resolve({ structuredContent: status })

    await expect(pending).rejects.toThrow("changed while the request was running")
  })
})
