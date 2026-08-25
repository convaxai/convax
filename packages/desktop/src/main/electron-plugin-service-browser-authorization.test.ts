import { EventEmitter } from "node:events"

import { describe, expect, mock, spyOn, test } from "bun:test"

interface FakeCookie {
  name: string
  value: string
}

class FakeCookies extends EventEmitter {
  readonly getCalls: string[] = []
  getError: Error | undefined
  values: FakeCookie[] = []

  async get({ url }: { url: string }) {
    this.getCalls.push(url)
    if (this.getError) throw this.getError
    return this.values.map((cookie) => ({ ...cookie }))
  }

  change(cookie: FakeCookie, removed = false) {
    this.emit("changed", {}, cookie, "explicit", removed)
  }
}

class FakeElectronSession extends EventEmitter {
  readonly cookies = new FakeCookies()
  clearAuthCacheCalls = 0
  clearCacheCalls = 0
  clearStorageDataCalls = 0

  async clearAuthCache() {
    this.clearAuthCacheCalls += 1
  }
  async clearCache() {
    this.clearCacheCalls += 1
  }
  async clearStorageData() {
    this.clearStorageDataCalls += 1
  }
  setPermissionCheckHandler() {}
  setPermissionRequestHandler() {}
}

class FakeWebContents extends EventEmitter {
  currentUrl = "about:blank"
  readonly isolatedWorldCalls: Array<{ scripts: Array<{ code: string }>; worldId: number }> = []
  readonly mainFrame = { frameTreeNodeId: 1, parent: null, processId: 100, routingId: 1, url: "about:blank" }
  openHandler:
    | ((details: { url: string }) => { action: string; overrideBrowserWindowOptions?: Record<string, unknown> })
    | undefined

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: string; overrideBrowserWindowOptions?: Record<string, unknown> },
  ) {
    this.openHandler = handler
  }

  getURL() {
    return this.currentUrl
  }

  async executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>) {
    this.isolatedWorldCalls.push({
      scripts: scripts.map(({ code }) => ({ code })),
      worldId,
    })
    throw new Error("Main must not execute authorization-page JavaScript")
  }

  openPopup(url: string) {
    if (!this.openHandler) throw new Error("Expected a window-open handler")
    const result = this.openHandler({ url })
    if (result.action !== "allow") return { result }
    if (!result.overrideBrowserWindowOptions) throw new Error("Expected secure popup options")
    const child = new FakeBrowserWindow(result.overrideBrowserWindowOptions)
    this.emit("did-create-window", child, { url })
    return { child, result }
  }
}

class FakeBrowserWindow extends EventEmitter {
  readonly webContents = new FakeWebContents()
  destroyed = false
  destroyCalls = 0
  loadedUrls: string[] = []
  shown = false
  title = ""

  constructor(readonly options: unknown) {
    super()
    windows.push(this)
  }

  destroy() {
    if (this.destroyed) return
    this.destroyCalls += 1
    this.destroyed = true
    this.emit("closed")
  }

  isDestroyed() {
    return this.destroyed
  }

  async loadURL(url: string) {
    this.loadedUrls.push(url)
    this.webContents.currentUrl = url
    this.webContents.mainFrame.url = url
    if (url === request.loginUrl && nextAuthorizationLoadError) {
      const error = nextAuthorizationLoadError
      nextAuthorizationLoadError = undefined
      throw error
    }
  }

  requestUserClose() {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
    }
    this.emit("close", event)
    if (!event.defaultPrevented) this.destroy()
    return event.defaultPrevented
  }

  setTitle(title: string) {
    this.title = title
  }
  show() {
    this.shown = true
  }
}

let latestAuthorizationSession!: FakeElectronSession
const partitions: Array<{ name: string; options: unknown }> = []
const windows: FakeBrowserWindow[] = []
let nextAuthorizationLoadError: Error | undefined

void mock.module("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  session: {
    fromPartition(name: string, options: unknown) {
      partitions.push({ name, options })
      latestAuthorizationSession = new FakeElectronSession()
      return latestAuthorizationSession
    },
  },
}))

const { createElectronPluginServiceBrowserAuthorizationBroker, isPluginServiceBrowserNavigationAllowed } = await import(
  "./electron-plugin-service-browser-authorization"
)
const { pluginServiceBrowserAuthorizationRequestSchema } = await import("./plugin-service-browser-authorization")
const { pluginServiceBrowserAuthorizationVisualReadyChannel } = await import(
  "../plugin-service-browser-authorization-bridge"
)

const request = {
  authorizationId: "request_0123456789abcdef",
  cookieNames: ["session_id", "csrf-token"],
  cookieOrigin: "https://accounts.example.com",
  loginUrl: "https://accounts.example.com/sign-in?source=convax",
  schema: pluginServiceBrowserAuthorizationRequestSchema,
  timeoutSeconds: 60,
} as const

function beginAuthorization(signal?: AbortSignal) {
  const broker = createElectronPluginServiceBrowserAuthorizationBroker()
  const pending = broker.authorize({ pluginId: "account-tools", serviceId: "account-tools" }, request, {
    action: "authorize",
    isCurrent: async () => true,
    serviceIdentity: "a".repeat(64),
    snapshotDigest: "b".repeat(64),
    signal,
  })
  return { broker, pending }
}

function currentWindow() {
  const window = windows.at(-1)
  if (!window) throw new Error("Expected an authorization window")
  return window
}

function preventableEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function commitNavigation(window: FakeBrowserWindow, url: string = request.loginUrl) {
  window.webContents.currentUrl = url
  window.webContents.mainFrame.url = url
  window.webContents.emit("did-navigate", {}, url)
}

function signalVisualReady(
  window: FakeBrowserWindow,
  options: {
    args?: unknown[]
    channel?: string
    senderFrame?: {
      frameTreeNodeId?: number
      parent?: unknown
      processId?: number
      routingId?: number
      url: string
    }
  } = {},
) {
  window.webContents.emit(
    "ipc-message",
    {
      frameId: options.senderFrame?.routingId ?? window.webContents.mainFrame.routingId,
      processId: options.senderFrame?.processId ?? window.webContents.mainFrame.processId,
      sender: window.webContents,
      senderFrame: options.senderFrame ?? window.webContents.mainFrame,
    },
    options.channel ?? pluginServiceBrowserAuthorizationVisualReadyChannel,
    ...(options.args ?? []),
  )
}

describe("Electron Plugin service browser authorization", () => {
  test("allows only credential-free HTTPS navigation", () => {
    expect(isPluginServiceBrowserNavigationAllowed("https://accounts.example.com/sign-in")).toBeTrue()
    expect(isPluginServiceBrowserNavigationAllowed("https://id.example.net/oauth?state=opaque")).toBeTrue()
    expect(isPluginServiceBrowserNavigationAllowed("http://accounts.example.com/sign-in")).toBeFalse()
    expect(isPluginServiceBrowserNavigationAllowed("file:///private/secret")).toBeFalse()
    expect(isPluginServiceBrowserNavigationAllowed("javascript:alert(1)")).toBeFalse()
    expect(isPluginServiceBrowserNavigationAllowed("https://user:password@accounts.example.com/")).toBeFalse()
    expect(isPluginServiceBrowserNavigationAllowed("not a url")).toBeFalse()
  })

  test("reveals a visually ready HTTPS SPA without waiting for did-finish-load", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    const rootWindow = currentWindow()

    await flushMicrotasks()
    const loadingWindow = windows.at(-2)
    expect(loadingWindow?.shown).toBeTrue()
    expect(loadingWindow?.loadedUrls[0]).toStartWith("data:text/html;charset=UTF-8,")
    expect(rootWindow.shown).toBeFalse()
    expect(rootWindow.loadedUrls).toEqual([request.loginUrl])
    expect(rootWindow.options).toMatchObject({
      show: false,
      webPreferences: {
        preload: expect.stringMatching(/[\\/]preload[\\/]plugin-service-browser-authorization\.js$/),
        sandbox: true,
      },
    })

    commitNavigation(rootWindow)
    expect(rootWindow.shown).toBeFalse()

    signalVisualReady(rootWindow)
    expect(rootWindow.shown).toBeTrue()
    expect(loadingWindow?.destroyCalls).toBe(1)
    expect(rootWindow.webContents.isolatedWorldCalls).toHaveLength(0)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("does not reveal the remote window for its initial about:blank document", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    const rootWindow = currentWindow()

    rootWindow.webContents.currentUrl = "about:blank"
    rootWindow.webContents.mainFrame.url = "about:blank"
    signalVisualReady(rootWindow)
    expect(rootWindow.shown).toBeFalse()
    expect(rootWindow.webContents.isolatedWorldCalls).toHaveLength(0)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("rejects stale, subframe, and malformed visual-ready signals", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    const rootWindow = currentWindow()

    const nextUrl = "https://accounts.example.com/continue"
    commitNavigation(rootWindow, nextUrl)
    signalVisualReady(rootWindow, {
      senderFrame: { frameTreeNodeId: 1, parent: null, processId: 100, routingId: 1, url: request.loginUrl },
    })
    signalVisualReady(rootWindow, {
      senderFrame: {
        frameTreeNodeId: 2,
        parent: rootWindow.webContents.mainFrame,
        processId: 100,
        routingId: 2,
        url: nextUrl,
      },
    })
    signalVisualReady(rootWindow, { args: [true] })
    signalVisualReady(rootWindow, { channel: "plugin-service-browser-authorization:forged" })
    expect(rootWindow.shown).toBeFalse()

    signalVisualReady(rootWindow)
    expect(rootWindow.shown).toBeTrue()

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("cancellation removes the visual-readiness listener", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    const rootWindow = currentWindow()
    commitNavigation(rootWindow)
    expect(rootWindow.webContents.listenerCount("ipc-message")).toBe(1)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(rootWindow.webContents.listenerCount("ipc-message")).toBe(0)
    signalVisualReady(rootWindow)
    expect(rootWindow.shown).toBeFalse()
  })

  test("closing the host loading shell cancels and destroys the hidden remote window", async () => {
    const { pending } = beginAuthorization()
    const rootWindow = currentWindow()
    const loadingWindow = windows.at(-2)
    if (!loadingWindow) throw new Error("Expected a loading window")

    expect(loadingWindow.requestUserClose()).toBeTrue()
    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization was canceled",
      name: "AbortError",
    })
    expect(loadingWindow.destroyCalls).toBe(1)
    expect(rootWindow.destroyCalls).toBe(1)
  })

  test("ignores an aborted main-frame navigation during a normal redirect", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    const rootWindow = currentWindow()
    let finished = false
    void pending.then(
      () => {
        finished = true
      },
      () => {
        finished = true
      },
    )

    rootWindow.webContents.emit("did-fail-load", {}, -3, "ERR_ABORTED", request.loginUrl, true)
    await flushMicrotasks()
    expect(finished).toBeFalse()

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("keeps authorization active when the initial load promise is superseded by a redirect", async () => {
    const controller = new AbortController()
    nextAuthorizationLoadError = Object.assign(new Error("ERR_ABORTED (-3) loading sign-in"), {
      code: "ERR_ABORTED",
      errno: -3,
    })
    const { pending } = beginAuthorization(controller.signal)
    let finished = false
    void pending.then(
      () => {
        finished = true
      },
      () => {
        finished = true
      },
    )

    await flushMicrotasks()
    expect(finished).toBeFalse()

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("fails closed when the initial load promise rejects for a real error", async () => {
    nextAuthorizationLoadError = Object.assign(new Error("ERR_NAME_NOT_RESOLVED"), {
      code: "ERR_NAME_NOT_RESOLVED",
      errno: -105,
    })
    const { pending } = beginAuthorization()

    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization page could not be loaded",
    })
    expect(currentWindow().destroyCalls).toBe(1)
    expect(windows.at(-2)?.destroyCalls).toBe(1)
  })

  test("ignores subframe in-page navigation when maintaining the native title", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    const rootWindow = currentWindow()
    commitNavigation(rootWindow)
    expect(rootWindow.title).toBe("Service sign-in — accounts.example.com")

    rootWindow.webContents.emit("did-navigate-in-page", {}, "https://iframe.example.net/#step", false)
    expect(rootWindow.title).toBe("Service sign-in — accounts.example.com")

    rootWindow.webContents.emit("did-navigate-in-page", {}, "https://accounts.example.com/#step", true)
    expect(rootWindow.title).toBe("Service sign-in — accounts.example.com")

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  test("fails closed when the remote main frame cannot load", async () => {
    const { pending } = beginAuthorization()
    const rootWindow = currentWindow()

    rootWindow.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", request.loginUrl, true)

    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization page could not be loaded",
    })
    expect(rootWindow.destroyCalls).toBe(1)
    expect(windows.at(-2)?.destroyCalls).toBe(1)
  })

  test("fails closed when the remote renderer exits", async () => {
    const { pending } = beginAuthorization()
    const rootWindow = currentWindow()

    rootWindow.webContents.emit("render-process-gone", {}, { reason: "crashed" })

    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization page stopped unexpectedly",
    })
    expect(rootWindow.destroyCalls).toBe(1)
    expect(windows.at(-2)?.destroyCalls).toBe(1)
  })

  test("completes on an approved cookie change, re-reads the exact origin, and cleans listeners", async () => {
    const { pending } = beginAuthorization()
    expect(partitions.at(-1)?.name.startsWith("convax-service-authorization-")).toBeTrue()
    expect(partitions.at(-1)?.options).toEqual({ cache: true })
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(1)

    latestAuthorizationSession.cookies.values = [
      { name: "session_id", value: "secret-session" },
      { name: "not-approved", value: "must-not-leave" },
    ]
    latestAuthorizationSession.cookies.change({ name: "session_id", value: "secret-session" })

    const completion = await pending
    expect(completion.cookies).toEqual([{ name: "session_id", value: "secret-session" }])
    expect(latestAuthorizationSession.cookies.getCalls).toEqual([
      "https://accounts.example.com/",
      "https://accounts.example.com/",
    ])
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(0)
    expect(currentWindow().listenerCount("close")).toBe(0)
    expect(currentWindow().listenerCount("closed")).toBe(0)
    expect(currentWindow().destroyCalls).toBe(1)
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(1)
    expect(latestAuthorizationSession.clearCacheCalls).toBe(1)
    expect(latestAuthorizationSession.clearAuthCacheCalls).toBe(1)
  })

  test("treats a user close as completion only when the exact origin has an approved cookie", async () => {
    const { pending } = beginAuthorization()
    latestAuthorizationSession.cookies.values = [{ name: "csrf-token", value: "approved" }]

    expect(currentWindow().requestUserClose()).toBeTrue()
    expect(await pending).toMatchObject({
      cookies: [{ name: "csrf-token", value: "approved" }],
    })
    expect(latestAuthorizationSession.cookies.getCalls).toEqual([
      "https://accounts.example.com/",
      "https://accounts.example.com/",
    ])
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(0)
    expect(currentWindow().destroyCalls).toBe(1)
  })

  test("keeps HTTPS login popups native, recursively hardened, and independent from root confirmation", async () => {
    const { pending } = beginAuthorization()
    const rootWindow = currentWindow()
    const windowCount = windows.length

    expect(rootWindow.webContents.openPopup("http://accounts.example.com/callback").result).toEqual({
      action: "deny",
    })
    expect(windows).toHaveLength(windowCount)

    const popupUrl = "https://id.example.net/oauth?state=opaque"
    const popup = rootWindow.webContents.openPopup(popupUrl)
    expect(popup.result.action).toBe("allow")
    expect(rootWindow.loadedUrls).toEqual([request.loginUrl])
    expect(popup.child).toBeDefined()
    const popupOptions = popup.result.overrideBrowserWindowOptions
    expect(popupOptions).toMatchObject({
      show: true,
      title: "Service sign-in — id.example.net",
      webPreferences: {
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
        contextIsolation: true,
        devTools: false,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        safeDialogs: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    })
    expect((popupOptions?.webPreferences as Record<string, unknown>).session).toBe(latestAuthorizationSession)

    const insecureNavigation = preventableEvent()
    popup.child?.webContents.emit("will-navigate", insecureNavigation, "http://accounts.example.com/callback")
    expect(insecureNavigation.defaultPrevented).toBeTrue()
    const secureNavigation = preventableEvent()
    popup.child?.webContents.emit("will-redirect", secureNavigation, "https://accounts.example.com/callback")
    expect(secureNavigation.defaultPrevented).toBeFalse()
    const login = preventableEvent()
    popup.child?.webContents.emit("login", login)
    expect(login.defaultPrevented).toBeTrue()
    const webview = preventableEvent()
    popup.child?.webContents.emit("will-attach-webview", webview)
    expect(webview.defaultPrevented).toBeTrue()
    const download = preventableEvent()
    latestAuthorizationSession.emit("will-download", download)
    expect(download.defaultPrevented).toBeTrue()

    expect(popup.child?.webContents.openPopup("javascript:window.close()").result).toEqual({ action: "deny" })
    const grandchild = popup.child?.webContents.openPopup("https://accounts.example.com/second-step")
    expect(grandchild?.result.action).toBe("allow")
    expect((grandchild?.result.overrideBrowserWindowOptions?.webPreferences as Record<string, unknown>).session).toBe(
      latestAuthorizationSession,
    )

    let finished = false
    void pending.finally(() => {
      finished = true
    })
    popup.child?.destroy()
    await flushMicrotasks()
    expect(finished).toBeFalse()
    expect(rootWindow.destroyed).toBeFalse()
    expect(latestAuthorizationSession.cookies.getCalls).toEqual([])

    latestAuthorizationSession.cookies.values = [{ name: "session_id", value: "approved" }]
    latestAuthorizationSession.cookies.change({ name: "session_id", value: "approved" })

    expect(await pending).toMatchObject({
      cookies: [{ name: "session_id", value: "approved" }],
    })
    expect(rootWindow.destroyCalls).toBe(1)
    expect(popup.child?.destroyCalls).toBe(1)
    expect(grandchild?.child?.destroyCalls).toBe(1)
    expect(latestAuthorizationSession.cookies.getCalls).toEqual([
      "https://accounts.example.com/",
      "https://accounts.example.com/",
    ])
  })

  test("re-checks the exact origin when Electron emits closed directly and preserves a successful sign-in", async () => {
    const { pending } = beginAuthorization()
    latestAuthorizationSession.cookies.values = [{ name: "session_id", value: "approved" }]

    currentWindow().destroy()
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(0)

    expect(await pending).toMatchObject({
      cookies: [{ name: "session_id", value: "approved" }],
    })
    expect(latestAuthorizationSession.cookies.getCalls).toEqual([
      "https://accounts.example.com/",
      "https://accounts.example.com/",
    ])
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(0)
    expect(currentWindow().listenerCount("close")).toBe(0)
    expect(currentWindow().listenerCount("closed")).toBe(0)
    expect(currentWindow().destroyCalls).toBe(1)
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(1)
  })

  test("waits for a delayed exact-origin Cookie commit after the remote page closes itself", async () => {
    const clearTimer = spyOn(globalThis, "clearTimeout")
    const { pending } = beginAuthorization()

    currentWindow().destroy()
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(0)
    await flushMicrotasks()
    latestAuthorizationSession.cookies.values = [{ name: "session_id", value: "delayed-approved" }]
    latestAuthorizationSession.cookies.change({ name: "session_id", value: "delayed-approved" })

    expect(await pending).toMatchObject({
      cookies: [{ name: "session_id", value: "delayed-approved" }],
    })
    expect(latestAuthorizationSession.cookies.getCalls).toEqual([
      "https://accounts.example.com/",
      "https://accounts.example.com/",
      "https://accounts.example.com/",
    ])
    expect(clearTimer).toHaveBeenCalled()
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(1)
    clearTimer.mockRestore()
  })

  test("fails closed after a direct closed event without an approved cookie", async () => {
    const { pending } = beginAuthorization()
    latestAuthorizationSession.cookies.values = [{ name: "not-approved", value: "irrelevant" }]

    currentWindow().destroy()

    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization window closed",
      name: "AbortError",
    })
    expect(latestAuthorizationSession.cookies.getCalls.length).toBeGreaterThan(1)
    expect(new Set(latestAuthorizationSession.cookies.getCalls)).toEqual(new Set(["https://accounts.example.com/"]))
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(0)
    expect(currentWindow().listenerCount("close")).toBe(0)
    expect(currentWindow().listenerCount("closed")).toBe(0)
    expect(currentWindow().destroyCalls).toBe(1)
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(1)
  })

  test("fails closed and cleans up when the direct-closed cookie check errors", async () => {
    const { pending } = beginAuthorization()
    latestAuthorizationSession.cookies.getError = new Error("native cookie store unavailable")

    currentWindow().destroy()

    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization cookies could not be checked",
    })
    expect(latestAuthorizationSession.cookies.getCalls).toEqual(["https://accounts.example.com/"])
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(0)
    expect(currentWindow().listenerCount("close")).toBe(0)
    expect(currentWindow().listenerCount("closed")).toBe(0)
    expect(currentWindow().destroyCalls).toBe(1)
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(1)
  })

  test("does not complete without an approved cookie and a cookie-less close cancels", async () => {
    const { pending } = beginAuthorization()
    let finished = false
    void pending.then(
      () => {
        finished = true
      },
      () => {
        finished = true
      },
    )

    latestAuthorizationSession.cookies.values = [{ name: "not-approved", value: "irrelevant" }]
    latestAuthorizationSession.cookies.change({ name: "not-approved", value: "irrelevant" })
    latestAuthorizationSession.cookies.change({ name: "session_id", value: "removed" }, true)
    latestAuthorizationSession.cookies.change({ name: "session_id", value: "other-origin" })
    await flushMicrotasks()

    expect(finished).toBeFalse()
    expect(latestAuthorizationSession.cookies.getCalls).toEqual(["https://accounts.example.com/"])
    expect(currentWindow().requestUserClose()).toBeTrue()
    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization was canceled",
      name: "AbortError",
    })
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(0)
    expect(currentWindow().listenerCount("close")).toBe(0)
    expect(currentWindow().listenerCount("closed")).toBe(0)
    expect(currentWindow().destroyCalls).toBe(1)
  })

  test("programmatic close after cancellation cannot race in a window-closed error", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    controller.abort()

    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization was canceled",
      name: "AbortError",
    })
    expect(latestAuthorizationSession.cookies.listenerCount("changed")).toBe(0)
    expect(currentWindow().listenerCount("close")).toBe(0)
    expect(currentWindow().listenerCount("closed")).toBe(0)
    expect(currentWindow().destroyCalls).toBe(1)
  })

  test("cancellation destroys a still-open HTTPS popup before clearing its shared session", async () => {
    const controller = new AbortController()
    const { pending } = beginAuthorization(controller.signal)
    const rootWindow = currentWindow()
    const popup = rootWindow.webContents.openPopup("https://id.example.net/oauth?state=cancel")
    expect(popup.child?.destroyed).toBeFalse()

    controller.abort()

    expect(await pending.catch((error: unknown) => error)).toMatchObject({
      message: "Plugin service browser authorization was canceled",
      name: "AbortError",
    })
    expect(popup.child?.destroyCalls).toBe(1)
    expect(rootWindow.destroyCalls).toBe(1)
    expect(latestAuthorizationSession.clearStorageDataCalls).toBe(1)
  })
})
