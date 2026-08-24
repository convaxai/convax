import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { BrowserWindow, session } from "electron"

import { pluginServiceBrowserAuthorizationVisualReadyChannel } from "../plugin-service-browser-authorization-bridge"
import type { PluginServiceTarget } from "../plugin-service-contracts"
import {
  PluginServiceBrowserAuthorizationBroker,
  type PluginServiceBrowserAuthorizationRequest,
  type PluginServiceBrowserAuthorizationSession,
} from "./plugin-service-browser-authorization"
import type { PluginServiceAuthorizationCheckpointStore } from "./plugin-service-authorization-checkpoints"

// A remote OAuth callback can close its popup/root before Chromium publishes
// the final Set-Cookie mutation to the shared session. Keep the exact-origin
// Cookie listener alive for a short, bounded grace period instead of turning a
// successful sign-in into a cancellation race.
const closedWindowCookieCommitGraceMs = 2_000
const closedWindowCookiePollIntervalMs = 100
const authorizationVisualReadinessPreload = join(
  import.meta.dirname,
  "../preload/plugin-service-browser-authorization.js",
)

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function isAbortedNavigationError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const input = error as { code?: unknown; errno?: unknown }
  return input.code === "ERR_ABORTED" || input.errno === -3
}

/** Authorization BrowserWindows may navigate only on the encrypted Web surface. */
export function isPluginServiceBrowserNavigationAllowed(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
  } catch {
    return false
  }
}

function authorizationWindowTitle(url: string) {
  try {
    return `Service sign-in — ${new URL(url).host}`
  } catch {
    return "Service sign-in"
  }
}

function authorizationLoadingWindowTitle(url: string) {
  try {
    return `Loading service sign-in — ${new URL(url).host}`
  } catch {
    return "Loading service sign-in"
  }
}

const authorizationLoadingPage = `data:text/html;charset=UTF-8,${encodeURIComponent(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { align-items: center; background: #f7f7f8; color: #202124; display: flex; height: 100vh; justify-content: center; margin: 0; }
      main { align-items: center; display: flex; flex-direction: column; gap: 18px; padding: 32px; text-align: center; }
      .spinner { animation: spin 900ms linear infinite; border: 3px solid #dedee3; border-radius: 50%; border-top-color: #6d5ce8; height: 28px; width: 28px; }
      h1 { font-size: 18px; font-weight: 600; margin: 0; }
      p { color: #686970; font-size: 14px; line-height: 1.5; margin: 0; max-width: 420px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .spinner { animation: none; border-top-color: #6d5ce8; } }
    </style>
  </head>
  <body>
    <main aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <h1>Loading service sign-in…</h1>
      <p>The service page is still downloading. You can close this window to cancel.</p>
    </main>
  </body>
</html>`)}\n`

export async function createElectronAuthorizationSession(
  _target: PluginServiceTarget,
  request: PluginServiceBrowserAuthorizationRequest,
): Promise<PluginServiceBrowserAuthorizationSession> {
  // A partition without the persist: prefix is in-memory and cannot reuse the
  // application's renderer or the user's normal browser session.
  const authorizationSession = session.fromPartition(`convax-service-authorization-${randomUUID()}`, {
    // Keep Chromium's cache available only for the lifetime of this fresh,
    // non-persistent authorization session. Large SPA sign-in surfaces can
    // then reuse their immutable assets across redirects and OAuth popups,
    // while clear() still removes the cache before the session is discarded.
    cache: true,
  })
  authorizationSession.setPermissionCheckHandler(() => false)
  authorizationSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  authorizationSession.on("will-download", (event) => event.preventDefault())

  const authorizationWebPreferences: Electron.WebPreferences = {
    allowRunningInsecureContent: false,
    // The host loading shell keeps the remote window hidden until it has a UI.
    // Do not let Chromium treat that security/UX choice as a background tab and
    // throttle the sign-in page's initial scripts and timers.
    backgroundThrottling: false,
    contextIsolation: true,
    devTools: false,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    safeDialogs: true,
    sandbox: true,
    session: authorizationSession,
    webSecurity: true,
    webviewTag: false,
  }
  const authorizationWindowOptions = (
    url: string,
    show = false,
    preload?: string,
  ): Electron.BrowserWindowConstructorOptions => ({
    backgroundColor: "#ffffff",
    height: 760,
    minHeight: 520,
    minWidth: 640,
    show,
    title: authorizationWindowTitle(url),
    width: 980,
    webPreferences: {
      ...authorizationWebPreferences,
      ...(preload ? { preload } : {}),
    },
  })
  const loadingWindow = new BrowserWindow({
    backgroundColor: "#f7f7f8",
    height: 760,
    minHeight: 520,
    minWidth: 640,
    show: false,
    title: authorizationLoadingWindowTitle(request.loginUrl),
    width: 980,
    webPreferences: {
      ...authorizationWebPreferences,
      safeDialogs: true,
    },
  })
  const window = new BrowserWindow(
    authorizationWindowOptions(request.loginUrl, false, authorizationVisualReadinessPreload),
  )
  const childWindows = new Set<BrowserWindow>()

  const approvedCookieNames = new Set(request.cookieNames)
  let allowClose = false
  let closeCheckPending = false
  let closeCookiePollTimer: ReturnType<typeof setTimeout> | undefined
  let confirmationListenersAttached = false
  let loadingWindowMayClose = false
  let authorizationWindowRevealed = false
  let settled = false
  let resolveConfirmation!: () => void
  let rejectConfirmation!: (error: Error) => void
  const confirmation = new Promise<void>((resolve, reject) => {
    resolveConfirmation = resolve
    rejectConfirmation = reject
  })

  let onCookieChanged!: Parameters<Electron.Cookies["on"]>[1]
  let onVisualReadinessMessage!: (event: Electron.IpcMainEvent, channel: string, ...args: unknown[]) => void
  let onWindowClose!: (event: Electron.Event) => void
  let onWindowClosed!: () => void
  const removeConfirmationListeners = () => {
    if (!confirmationListenersAttached) return
    confirmationListenersAttached = false
    authorizationSession.cookies.removeListener("changed", onCookieChanged)
    window.webContents.removeListener("ipc-message", onVisualReadinessMessage)
    window.removeListener("close", onWindowClose)
    window.removeListener("closed", onWindowClosed)
  }
  const clearCloseCookiePoll = () => {
    if (closeCookiePollTimer !== undefined) clearTimeout(closeCookiePollTimer)
    closeCookiePollTimer = undefined
    closeCheckPending = false
  }
  const settleConfirmed = () => {
    if (settled) return
    settled = true
    clearCloseCookiePoll()
    removeConfirmationListeners()
    resolveConfirmation()
  }
  const settleRejected = (error: Error) => {
    if (settled) return
    settled = true
    clearCloseCookiePoll()
    removeConfirmationListeners()
    rejectConfirmation(error)
  }
  const closeLoadingWindow = () => {
    loadingWindowMayClose = true
    if (!loadingWindow.isDestroyed()) loadingWindow.destroy()
  }
  const revealAuthorizationWindow = () => {
    if (
      settled ||
      authorizationWindowRevealed ||
      window.isDestroyed() ||
      !isPluginServiceBrowserNavigationAllowed(window.webContents.getURL())
    ) {
      return
    }
    authorizationWindowRevealed = true
    closeLoadingWindow()
    window.show()
  }
  const hasApprovedCookie = async () =>
    (await authorizationSession.cookies.get({ url: `${request.cookieOrigin}/` })).some(({ name }) =>
      approvedCookieNames.has(name),
    )
  const rejectCookieCheck = () => {
    settleRejected(new Error("Plugin service browser authorization cookies could not be checked"))
  }
  const checkApprovedCookieForClose = (missingCookieError: Error, options: { waitForDelayedCommit?: boolean } = {}) => {
    if (closeCheckPending || settled) return
    closeCheckPending = true
    const deadline = Date.now() + (options.waitForDelayedCommit ? closedWindowCookieCommitGraceMs : 0)
    const inspect = () => {
      void hasApprovedCookie().then(
        (approved) => {
          if (settled) return
          if (approved) {
            closeCheckPending = false
            settleConfirmed()
            return
          }
          const remaining = deadline - Date.now()
          if (remaining > 0) {
            closeCookiePollTimer = setTimeout(() => {
              closeCookiePollTimer = undefined
              inspect()
            }, Math.min(closedWindowCookiePollIntervalMs, remaining))
            closeCookiePollTimer.unref?.()
            return
          }
          closeCheckPending = false
          settleRejected(missingCookieError)
        },
        () => {
          closeCheckPending = false
          if (!settled) rejectCookieCheck()
        },
      )
    }
    inspect()
  }
  const guardNavigation = (event: Electron.Event, url: string) => {
    if (!isPluginServiceBrowserNavigationAllowed(url)) event.preventDefault()
  }
  const secureAuthorizationWindow = (targetWindow: BrowserWindow) => {
    const { webContents } = targetWindow
    const updateTitle = (_event: Electron.Event, url: string) => {
      if (!targetWindow.isDestroyed()) targetWindow.setTitle(authorizationWindowTitle(url))
    }
    webContents.on("will-navigate", guardNavigation)
    webContents.on("will-redirect", guardNavigation)
    webContents.on("did-navigate", updateTitle)
    webContents.on("did-navigate-in-page", (event, url, isMainFrame) => {
      if (isMainFrame) updateTitle(event, url)
    })
    webContents.on("page-title-updated", (event) => event.preventDefault())
    webContents.on("will-attach-webview", (event) => event.preventDefault())
    webContents.on("login", (event) => event.preventDefault())
    webContents.setWindowOpenHandler(({ url }) => {
      if (!isPluginServiceBrowserNavigationAllowed(url)) return { action: "deny" }
      return {
        action: "allow",
        // Popups are created before `did-create-window` can attach listeners,
        // so make them visible directly instead of relying on a later
        // `ready-to-show` subscription. Returning `allow` preserves opener.
        overrideBrowserWindowOptions: authorizationWindowOptions(url, true),
      }
    })
    webContents.on("did-create-window", (childWindow) => {
      childWindows.add(childWindow)
      childWindow.once("closed", () => childWindows.delete(childWindow))
      secureAuthorizationWindow(childWindow)
    })
  }

  secureAuthorizationWindow(window)
  loadingWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  loadingWindow.webContents.on("will-attach-webview", (event) => event.preventDefault())
  loadingWindow.on("close", (event) => {
    if (allowClose || loadingWindowMayClose) return
    event.preventDefault()
    settleRejected(abortError("Plugin service browser authorization was canceled"))
  })
  onCookieChanged = (_event, cookie, _cause, removed) => {
    if (settled || removed || !approvedCookieNames.has(cookie.name)) return
    void hasApprovedCookie().then((approved) => {
      if (approved) settleConfirmed()
    }, rejectCookieCheck)
  }
  onVisualReadinessMessage = (event, channel, ...args) => {
    if (
      channel !== pluginServiceBrowserAuthorizationVisualReadyChannel ||
      args.length !== 0 ||
      settled ||
      authorizationWindowRevealed ||
      window.isDestroyed() ||
      !event.senderFrame ||
      event.sender !== window.webContents ||
      event.senderFrame.parent !== null ||
      event.senderFrame.frameTreeNodeId !== window.webContents.mainFrame.frameTreeNodeId
    ) {
      return
    }
    const currentUrl = window.webContents.getURL()
    if (event.senderFrame.url !== currentUrl || !isPluginServiceBrowserNavigationAllowed(currentUrl)) return
    revealAuthorizationWindow()
  }
  onWindowClose = (event) => {
    if (allowClose) return
    event.preventDefault()
    checkApprovedCookieForClose(abortError("Plugin service browser authorization was canceled"))
  }
  onWindowClosed = () => {
    // Electron may emit `closed` without the cancelable `close` event (for
    // example when the remote page closes its own window). Keep the isolated
    // session alive until this exact-origin check settles so a successful
    // sign-in cannot be discarded by broker cleanup.
    checkApprovedCookieForClose(abortError("Plugin service browser authorization window closed"), {
      waitForDelayedCommit: true,
    })
  }
  authorizationSession.cookies.on("changed", onCookieChanged)
  window.webContents.on("ipc-message", onVisualReadinessMessage)
  window.on("close", onWindowClose)
  window.on("closed", onWindowClosed)
  confirmationListenersAttached = true

  // A large SPA may render a usable sign-in surface while the main frame is
  // still loading. Electron deliberately queues webContents.executeJavaScript*
  // until did-stop-loading, so the dedicated sandbox preload observes its own
  // document and emits one fixed, argument-free readiness signal instead. The
  // IPC event itself is bound to the current top-level frame and HTTPS URL; a
  // second navigation-state gate would only race that authoritative signal.
  window.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedUrl, isMainFrame) => {
    // Chromium reports redirects and superseded navigations as ERR_ABORTED;
    // those are part of normal sign-in flows. A real main-frame load failure
    // must fail closed instead of leaving a host loading shell forever.
    if (!isMainFrame || errorCode === -3) return
    settleRejected(new Error("Plugin service browser authorization page could not be loaded"))
  })
  window.webContents.on("render-process-gone", () => {
    settleRejected(new Error("Plugin service browser authorization page stopped unexpectedly"))
  })

  // A remote SPA can spend a long time downloading its first executable UI.
  // Show a tiny host-owned page while the hardened remote window remains
  // hidden, then reveal only after the isolated visual probe confirms a UI.
  void loadingWindow.loadURL(authorizationLoadingPage).then(
    () => {
      if (!settled && !loadingWindow.isDestroyed()) loadingWindow.show()
    },
    () => {
      if (!settled && !loadingWindow.isDestroyed()) loadingWindow.show()
    },
  )

  // Do not await navigation here: the broker must receive the session handle
  // immediately so cancellation and its timeout can always destroy the window.
  void window.loadURL(request.loginUrl).catch((error: unknown) => {
    if (isAbortedNavigationError(error)) return
    settleRejected(new Error("Plugin service browser authorization page could not be loaded"))
  })

  return {
    async clear() {
      await authorizationSession.clearStorageData()
      await authorizationSession.clearCache()
      await authorizationSession.clearAuthCache()
    },
    close() {
      allowClose = true
      // Broker cleanup runs only after confirmation or cancellation has already
      // settled its caller. Mark any orphaned native confirmation inert before
      // destroy() emits `closed`, so programmatic cleanup cannot win a race with
      // the actual outcome.
      settled = true
      clearCloseCookiePoll()
      removeConfirmationListeners()
      for (const childWindow of childWindows) {
        if (!childWindow.isDestroyed()) childWindow.destroy()
      }
      childWindows.clear()
      closeLoadingWindow()
      if (!window.isDestroyed()) window.destroy()
    },
    async readCookies(origin) {
      return (await authorizationSession.cookies.get({ url: `${origin}/` })).map(({ expirationDate, name, value }) => {
        if (expirationDate === undefined) return { name, value }
        const expiresAt = Math.floor(expirationDate * 1_000)
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
          throw new Error("Plugin service browser authorization returned an invalid Cookie expiry")
        }
        return { expiresAt, name, value }
      })
    },
    async waitForConfirmation(signal) {
      if (signal.aborted) throw abortError("Plugin service browser authorization was canceled")
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          cleanup()
          reject(abortError("Plugin service browser authorization was canceled"))
        }
        const cleanup = () => signal.removeEventListener("abort", onAbort)
        signal.addEventListener("abort", onAbort, { once: true })
        void confirmation.then(
          () => {
            cleanup()
            resolve()
          },
          (error) => {
            cleanup()
            reject(error)
          },
        )
      })
    },
  }
}

export function createElectronPluginServiceBrowserAuthorizationBroker(
  checkpoints?: PluginServiceAuthorizationCheckpointStore,
) {
  return new PluginServiceBrowserAuthorizationBroker(createElectronAuthorizationSession, checkpoints)
}
