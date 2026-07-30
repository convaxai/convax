import { afterEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  PluginServiceBrowserAuthorizationBroker,
  parsePluginServiceBrowserAuthorizationRequest,
  pluginServiceBrowserAuthorizationCompletionSchema,
  pluginServiceBrowserAuthorizationRequestSchema,
  type PluginServiceBrowserAuthorizationSession,
} from "./plugin-service-browser-authorization"
import { PluginServiceAuthorizationCheckpointStore } from "./plugin-service-authorization-checkpoints"

const rawRequest = {
  authorization_id: "request_0123456789abcdef",
  cookie_names: ["session_id", "csrf-token"],
  cookie_origin: "https://accounts.example.com",
  login_url: "https://accounts.example.com/sign-in?source=convax",
  schema: pluginServiceBrowserAuthorizationRequestSchema,
  timeout_seconds: 60,
} as const

const authorizationOptions = {
  action: "authorize" as const,
  isCurrent: async () => true,
  serviceIdentity: "a".repeat(64),
  snapshotDigest: "b".repeat(64),
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, reject, resolve }
}

function fakeSession(
  cookies: readonly { expiresAt?: number; name: string; value: string }[] = [
    { name: "session_id", value: "secret-session" },
    { name: "not-approved", value: "must-not-leave" },
  ],
) {
  const confirmation = deferred()
  const calls = { clear: 0, close: 0, origins: [] as string[] }
  const session: PluginServiceBrowserAuthorizationSession = {
    async clear() {
      calls.clear += 1
    },
    close() {
      calls.close += 1
    },
    async readCookies(origin) {
      calls.origins.push(origin)
      return cookies
    },
    waitForConfirmation(signal) {
      if (signal.aborted) return Promise.reject(signal.reason)
      return new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(signal.reason)
        signal.addEventListener("abort", onAbort, { once: true })
        void confirmation.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
      })
    },
  }
  return { calls, confirmation, session }
}

describe("Plugin service browser authorization", () => {
  test("accepts only a strict same-origin HTTPS request", () => {
    expect(parsePluginServiceBrowserAuthorizationRequest(rawRequest)).toEqual({
      authorizationId: "request_0123456789abcdef",
      cookieNames: ["session_id", "csrf-token"],
      cookieOrigin: "https://accounts.example.com",
      loginUrl: "https://accounts.example.com/sign-in?source=convax",
      schema: pluginServiceBrowserAuthorizationRequestSchema,
      timeoutSeconds: 60,
    })
    expect(
      parsePluginServiceBrowserAuthorizationRequest({ ...rawRequest, timeout_seconds: 1_800 }).timeoutSeconds,
    ).toBe(1_800)

    for (const invalid of [
      { ...rawRequest, cookie_origin: "http://accounts.example.com", login_url: "http://accounts.example.com/sign-in" },
      { ...rawRequest, login_url: "https://phishing.example/sign-in" },
      { ...rawRequest, login_url: "https://user:password@accounts.example.com/sign-in" },
      { ...rawRequest, cookie_names: ["session_id", "session_id"] },
      { ...rawRequest, cookie_names: ["Cookie: session=x"] },
      { ...rawRequest, timeout_seconds: 29 },
      { ...rawRequest, timeout_seconds: 1_801 },
      { ...rawRequest, token: "must-not-be-accepted" },
    ]) {
      expect(() => parsePluginServiceBrowserAuthorizationRequest(invalid)).toThrow()
    }
  })

  test("exports only allowlisted names from the exact origin and always clears the session", async () => {
    const browser = fakeSession()
    const broker = new PluginServiceBrowserAuthorizationBroker(async () => browser.session)
    const pending = broker.authorize("account-tools", parsePluginServiceBrowserAuthorizationRequest(rawRequest), {
      ...authorizationOptions,
    })
    browser.confirmation.resolve()

    const completion = await pending
    expect(completion).toEqual({
      authorization_id: "request_0123456789abcdef",
      cookie_origin: "https://accounts.example.com",
      cookies: [{ name: "session_id", value: "secret-session" }],
      schema: pluginServiceBrowserAuthorizationCompletionSchema,
    })
    expect(browser.calls).toEqual({
      clear: 1,
      close: 1,
      origins: ["https://accounts.example.com"],
    })
    expect(JSON.stringify(completion)).not.toContain("must-not-leave")
  })

  test("checkpoints before clearing the browser and resumes with a fresh sidecar request without reopening it", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-browser-checkpoint-test-"))
    temporaryRoots.push(temporaryRoot)
    const checkpoints = new PluginServiceAuthorizationCheckpointStore(path.join(temporaryRoot, "checkpoints"))
    const cookieExpiry = Date.now() + 10 * 60_000
    const browser = fakeSession([
      { expiresAt: cookieExpiry, name: "session_id", value: "secret-session" },
      { name: "not-approved", value: "must-not-leave" },
    ])
    const first = new PluginServiceBrowserAuthorizationBroker(() => browser.session, checkpoints)
    const firstPending = first.authorize(
      "account-tools",
      parsePluginServiceBrowserAuthorizationRequest(rawRequest),
      authorizationOptions,
    )
    browser.confirmation.resolve()

    const captured = await firstPending
    expect(browser.calls.clear).toBe(1)
    expect(
      await checkpoints.inspect({
        pluginId: "account-tools",
        serviceIdentity: authorizationOptions.serviceIdentity,
        snapshotDigest: authorizationOptions.snapshotDigest,
      }),
    ).toMatchObject({ action: "authorize" })
    expect(
      (
        await checkpoints.read({
          cookieNames: rawRequest.cookie_names,
          cookieOrigin: rawRequest.cookie_origin,
          pluginId: "account-tools",
          serviceIdentity: authorizationOptions.serviceIdentity,
          snapshotDigest: authorizationOptions.snapshotDigest,
        })
      )?.cookies,
    ).toEqual([{ expiresAt: cookieExpiry, name: "session_id", value: "secret-session" }])

    let browserReopens = 0
    const resumed = new PluginServiceBrowserAuthorizationBroker(() => {
      browserReopens += 1
      throw new Error("A recoverable authorization must not reopen the browser")
    }, checkpoints)
    const freshRequest = parsePluginServiceBrowserAuthorizationRequest({
      ...rawRequest,
      authorization_id: "request_fedcba9876543210",
    })
    expect(await resumed.authorize("account-tools", freshRequest, authorizationOptions)).toEqual({
      ...captured,
      authorization_id: "request_fedcba9876543210",
    })
    expect(browserReopens).toBe(0)

    await resumed.commitPlugin("account-tools")
    expect(
      await checkpoints.inspect({
        pluginId: "account-tools",
        serviceIdentity: authorizationOptions.serviceIdentity,
        snapshotDigest: authorizationOptions.snapshotDigest,
      }),
    ).toBeNull()
  })

  test("retains a recoverable checkpoint and does not reopen login on transient storage failure", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-browser-checkpoint-test-"))
    temporaryRoots.push(temporaryRoot)
    const checkpointRoot = path.join(temporaryRoot, "checkpoints")
    const checkpoints = new PluginServiceAuthorizationCheckpointStore(checkpointRoot)
    await checkpoints.write({
      action: "authorize",
      capturedAt: Date.now(),
      cookieNames: rawRequest.cookie_names,
      cookieOrigin: rawRequest.cookie_origin,
      cookies: [{ name: "session_id", value: "recoverable-session" }],
      pluginId: "account-tools",
      schema: "convax.plugin-service-authorization-checkpoint/2",
      serviceIdentity: authorizationOptions.serviceIdentity,
      snapshotDigest: authorizationOptions.snapshotDigest,
    })

    const originalRealpath = fs.realpath.bind(fs)
    const realpath = spyOn(fs, "realpath").mockImplementation((async (target: Parameters<typeof fs.realpath>[0]) => {
      if (String(target) === checkpointRoot) {
        throw Object.assign(new Error("temporary filesystem failure"), { code: "EBUSY" })
      }
      return originalRealpath(target)
    }) as unknown as typeof fs.realpath)
    let browserReopens = 0
    try {
      const broker = new PluginServiceBrowserAuthorizationBroker(() => {
        browserReopens += 1
        return fakeSession().session
      }, checkpoints)
      await expect(
        broker.authorize(
          "account-tools",
          parsePluginServiceBrowserAuthorizationRequest(rawRequest),
          authorizationOptions,
        ),
      ).rejects.toThrow("invalid or inaccessible")
      expect(browserReopens).toBe(0)
    } finally {
      realpath.mockRestore()
    }

    expect(
      await checkpoints.read({
        cookieNames: rawRequest.cookie_names,
        cookieOrigin: rawRequest.cookie_origin,
        pluginId: "account-tools",
        serviceIdentity: authorizationOptions.serviceIdentity,
        snapshotDigest: authorizationOptions.snapshotDigest,
      }),
    ).not.toBeNull()
  })

  test("fails closed on cancellation without reading cookies", async () => {
    const browser = fakeSession()
    const broker = new PluginServiceBrowserAuthorizationBroker(() => browser.session)
    const controller = new AbortController()
    const pending = broker.authorize("account-tools", parsePluginServiceBrowserAuthorizationRequest(rawRequest), {
      ...authorizationOptions,
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(browser.calls.origins).toEqual([])
    expect(browser.calls.clear).toBe(1)
    expect(browser.calls.close).toBe(1)
  })

  test("fails closed before export when the Plugin changed", async () => {
    const browser = fakeSession()
    const broker = new PluginServiceBrowserAuthorizationBroker(() => browser.session)
    const pending = broker.authorize("account-tools", parsePluginServiceBrowserAuthorizationRequest(rawRequest), {
      ...authorizationOptions,
      isCurrent: async () => false,
    })
    browser.confirmation.resolve()

    await expect(pending).rejects.toThrow("changed during browser authorization")
    expect(browser.calls.origins).toEqual([])
    expect(browser.calls.clear).toBe(1)
  })

  test("rejects ambiguous or oversized approved cookies", async () => {
    for (const cookies of [
      [
        { name: "session_id", value: "one" },
        { name: "session_id", value: "two" },
      ],
      [{ name: "session_id", value: "x".repeat(16 * 1024 + 1) }],
    ]) {
      const browser = fakeSession(cookies)
      const broker = new PluginServiceBrowserAuthorizationBroker(() => browser.session)
      const pending = broker.authorize("account-tools", parsePluginServiceBrowserAuthorizationRequest(rawRequest), {
        ...authorizationOptions,
      })
      browser.confirmation.resolve()
      await expect(pending).rejects.toThrow()
      expect(browser.calls.clear).toBe(1)
    }
  })

  test("sign-out/plugin disposal cancels and waits for native cleanup", async () => {
    const browser = fakeSession()
    const broker = new PluginServiceBrowserAuthorizationBroker(() => browser.session)
    const pending = broker.authorize("account-tools", parsePluginServiceBrowserAuthorizationRequest(rawRequest), {
      ...authorizationOptions,
    })

    await broker.disposePlugin("account-tools")
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(browser.calls.clear).toBe(1)
    expect(browser.calls.close).toBe(1)
  })
})
