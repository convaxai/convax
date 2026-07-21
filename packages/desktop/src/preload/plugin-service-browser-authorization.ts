import { ipcRenderer } from "electron"

import { pluginServiceBrowserAuthorizationVisualReadyChannel } from "../plugin-service-browser-authorization-bridge"

const visualReadinessPollIntervalMs = 250
const visibleCandidateSelector =
  'button, input:not([type="hidden"]), select, textarea, a[href], [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], [role="tab"], [contenteditable="true"], dialog[open], iframe, img, canvas, video, object, embed, svg'

function hasVisibleAuthorizationUi() {
  const body = document.body
  if (!body) return false

  const viewportWidth = Math.max(document.documentElement?.clientWidth ?? 0, globalThis.innerWidth ?? 0)
  const viewportHeight = Math.max(document.documentElement?.clientHeight ?? 0, globalThis.innerHeight ?? 0)
  if (viewportWidth <= 0 || viewportHeight <= 0) return false

  const candidates = body.querySelectorAll(visibleCandidateSelector)
  for (const element of candidates) {
    if (element.closest('[aria-hidden="true"]')) continue

    let visible = true
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number.parseFloat(style.opacity || "1") <= 0.01
      ) {
        visible = false
        break
      }
      if (ancestor === body) break
    }
    if (!visible || element.getClientRects().length === 0) continue

    const rect = element.getBoundingClientRect()
    const media = ["CANVAS", "EMBED", "IFRAME", "IMG", "OBJECT", "SVG", "VIDEO"].includes(element.tagName)
    const minimumSize = media ? 16 : 4
    if (rect.width < minimumSize || rect.height < minimumSize) continue
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportWidth || rect.top >= viewportHeight) continue
    return true
  }
  return false
}

let observer: MutationObserver | undefined
let poll: ReturnType<typeof setInterval> | undefined
let stopped = false

function stop() {
  if (stopped) return
  stopped = true
  observer?.disconnect()
  observer = undefined
  if (poll !== undefined) {
    clearInterval(poll)
    poll = undefined
  }
}

function inspect() {
  if (stopped) return
  if (!observer && document.documentElement) {
    observer = new MutationObserver(inspect)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-hidden", "class", "hidden", "open", "role", "style", "type"],
      childList: true,
      subtree: true,
    })
  }
  if (!hasVisibleAuthorizationUi()) return
  ipcRenderer.send(pluginServiceBrowserAuthorizationVisualReadyChannel)
  stop()
}

poll = setInterval(inspect, visualReadinessPollIntervalMs)
globalThis.addEventListener("pagehide", stop, { once: true })
document.addEventListener("DOMContentLoaded", inspect, { once: true })
inspect()
