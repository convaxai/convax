import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_FILE_BYTES,
  decodePanoramaImage,
  inspectDataUrlImage,
  inspectImageBytes,
} from "./panorama-image.js"
import { createPanoramaRenderer } from "./panorama-renderer.js"

const HOST_PROTOCOL = "convax.plugin-host/1"
const PLUGIN_ID = "panorama-viewer"
const CONNECTIONS_CHANGED_COMMAND = "canvas.connectedImages.changed"
const MIN_FOV = 30
const MAX_FOV = 100
const MAX_PITCH = 89
const AUTO_ROTATE_DEGREES_PER_SECOND = 3
const STATE_SAVE_DELAY = 320
const STATE_SAVE_MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT = 30000

const elements = {
  app: document.getElementById("app"),
  autoRotateButton: document.getElementById("autoRotateButton"),
  canvas: document.getElementById("panoramaCanvas"),
  captureButton: document.getElementById("captureButton"),
  chooseButton: document.getElementById("chooseButton"),
  connectionPill: document.getElementById("connectionPill"),
  connectionText: document.getElementById("connectionText"),
  dragHint: document.getElementById("dragHint"),
  emptyChooseButton: document.getElementById("emptyChooseButton"),
  emptyDescription: document.getElementById("emptyDescription"),
  emptyState: document.getElementById("emptyState"),
  emptyTitle: document.getElementById("emptyTitle"),
  fileInput: document.getElementById("fileInput"),
  fovOutput: document.getElementById("fovOutput"),
  fovRange: document.getElementById("fovRange"),
  fullscreenButton: document.getElementById("fullscreenButton"),
  fullscreenLabel: document.getElementById("fullscreenLabel"),
  imageDimensions: document.getElementById("imageDimensions"),
  imageMeta: document.getElementById("imageMeta"),
  imageRatio: document.getElementById("imageRatio"),
  interactionHint: document.getElementById("interactionHint"),
  loadingState: document.getElementById("loadingState"),
  loadingText: document.getElementById("loadingText"),
  refreshButton: document.getElementById("refreshButton"),
  resetButton: document.getElementById("resetButton"),
  sourceSelect: document.getElementById("sourceSelect"),
  sourceSelectShell: document.getElementById("sourceSelectShell"),
  sourceStatus: document.getElementById("sourceStatus"),
  toast: document.getElementById("toast"),
  viewer: document.getElementById("viewer"),
}

let hostPort = null
let requestSequence = 0
let pendingRequests = new Map()
let connectedImages = []
let refreshPromise = null
let refreshQueued = false
let refreshAfterPendingLoad = false
let refreshAfterPendingLoadForce = false
let currentSource = { kind: "none" }
let selectedSourceNodeId = null
let currentLocalFile = null
let pendingSourceIntent = null
let pendingSourceRequest = null
let deferredContextIntent = null
let loadSequence = 0
let stateSaveTimer = 0
let stateSaveInFlight = false
let stateSaveDirty = false
let stateSaveFailures = 0
let hostHydrated = false
let interactionGeneration = 0
let toastTimer = 0
let dragDepth = 0
let pointer = null
let animationFrame = 0
let lastFrameTime = 0
let lastInteractionHintTimer = 0
let captureInFlight = false

const viewState = {
  autoRotate: false,
  fovDeg: 75,
  pitchDeg: 0,
  yawDeg: 0,
}

const renderer = createPanoramaRenderer(elements.canvas, elements.viewer, scheduleRender)

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function normalizeYaw(value) {
  let result = finiteNumber(value, 0) % 360
  if (result > 180) result -= 360
  if (result < -180) result += 360
  return result
}

function setHidden(element, hidden) {
  element.classList.toggle("is-hidden", hidden)
}

function setLoading(active, label) {
  if (label) elements.loadingText.textContent = label
  setHidden(elements.loadingState, !active)
}

function showToast(message, tone) {
  window.clearTimeout(toastTimer)
  elements.toast.textContent = message
  elements.toast.classList.remove("is-hidden", "is-warning", "is-error")
  if (tone === "warning") elements.toast.classList.add("is-warning")
  if (tone === "error") elements.toast.classList.add("is-error")
  toastTimer = window.setTimeout(function () {
    elements.toast.classList.add("is-hidden")
  }, tone === "error" ? 5200 : 3600)
}

function setConnectionState(connected) {
  elements.connectionPill.classList.toggle("is-connected", connected)
  elements.connectionText.textContent = connected ? "画布已连接" : "等待宿主"
}

function setEmptyMessage(title, description) {
  elements.emptyTitle.textContent = title
  elements.emptyDescription.textContent = description
}

function setSourceStatus(label) {
  elements.sourceStatus.textContent = label
}

function updateViewControls() {
  const fov = Math.round(viewState.fovDeg)
  elements.fovRange.value = String(fov)
  elements.fovOutput.value = String(fov) + "°"
  elements.fovOutput.textContent = String(fov) + "°"
  elements.autoRotateButton.classList.toggle("is-active", viewState.autoRotate)
  elements.autoRotateButton.setAttribute("aria-pressed", String(viewState.autoRotate))
}

function updateCaptureControl() {
  elements.captureButton.disabled = captureInFlight || !renderer.texture || renderer.contextState !== "ready"
  elements.captureButton.setAttribute("aria-busy", String(captureInFlight))
}

function updateFullscreenControls() {
  const active = Boolean(document.fullscreenElement)
  elements.fullscreenLabel.textContent = active ? "退出全屏" : "全屏"
  elements.fullscreenButton.classList.toggle("is-active", active)
}

function updateImageMeta(width, height) {
  renderer.imageWidth = width
  renderer.imageHeight = height
  elements.imageDimensions.textContent = String(width) + " × " + String(height)
  elements.imageRatio.textContent = "比例 " + (width / height).toFixed(2) + ":1"
  setHidden(elements.imageMeta, false)
}

function clearImageMeta() {
  renderer.imageWidth = 0
  renderer.imageHeight = 0
  setHidden(elements.imageMeta, true)
}

function updateSourceSelect() {
  const previous = elements.sourceSelect.value
  elements.sourceSelect.replaceChildren()
  connectedImages.forEach(function (image) {
    const option = document.createElement("option")
    option.value = image.id
    option.textContent = image.name + (image.readable ? "" : "（不可读取）")
    option.disabled = !image.readable
    elements.sourceSelect.append(option)
  })
  setHidden(elements.sourceSelectShell, connectedImages.length === 0)
  const requested = currentSource.kind === "canvas" ? currentSource.nodeId : selectedSourceNodeId
  const selected = connectedImages.find(function (image) {
    return image.id === requested && image.readable
  })
  const fallback = connectedImages.find(function (image) {
    return image.id === previous && image.readable
  })
  if (selected) elements.sourceSelect.value = selected.id
  else if (fallback) elements.sourceSelect.value = fallback.id
}

function snapshotState() {
  return {
    schemaVersion: 1,
    selectedSourceNodeId: currentSource.kind === "canvas" ? currentSource.nodeId : selectedSourceNodeId,
    view: {
      autoRotate: viewState.autoRotate,
      fovDeg: Math.round(viewState.fovDeg * 100) / 100,
      pitchDeg: Math.round(viewState.pitchDeg * 100) / 100,
      yawDeg: Math.round(viewState.yawDeg * 100) / 100,
    },
  }
}

function hydrateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1) return
  const view = value.view
  if (view && typeof view === "object" && !Array.isArray(view)) {
    viewState.yawDeg = normalizeYaw(finiteNumber(view.yawDeg, viewState.yawDeg))
    viewState.pitchDeg = clamp(finiteNumber(view.pitchDeg, viewState.pitchDeg), -MAX_PITCH, MAX_PITCH)
    viewState.fovDeg = clamp(finiteNumber(view.fovDeg, viewState.fovDeg), MIN_FOV, MAX_FOV)
    viewState.autoRotate = view.autoRotate === true
  }
  if (typeof value.selectedSourceNodeId === "string" && value.selectedSourceNodeId.length <= 2048) {
    selectedSourceNodeId = value.selectedSourceNodeId
  }
  updateViewControls()
  scheduleRender()
}

function queueStateSave() {
  stateSaveDirty = true
  if (!hostPort || !hostHydrated || stateSaveTimer || stateSaveInFlight) return
  stateSaveTimer = window.setTimeout(flushStateSave, STATE_SAVE_DELAY)
}

async function flushStateSave() {
  if (stateSaveTimer) window.clearTimeout(stateSaveTimer)
  stateSaveTimer = 0
  if (!hostPort || !hostHydrated || stateSaveInFlight || !stateSaveDirty) return false
  stateSaveDirty = false
  stateSaveInFlight = true
  try {
    await hostRequest("canvas.node.updateState", { state: snapshotState() })
    stateSaveFailures = 0
    return true
  } catch (error) {
    stateSaveFailures += 1
    if (stateSaveFailures < STATE_SAVE_MAX_ATTEMPTS && hostPort) {
      stateSaveDirty = true
      stateSaveTimer = window.setTimeout(
        flushStateSave,
        STATE_SAVE_DELAY * Math.pow(2, stateSaveFailures),
      )
    } else {
      showToast(errorMessage(error, "视角状态保存失败；请重新打开插件后再试"), "error")
    }
    return false
  } finally {
    stateSaveInFlight = false
    if (stateSaveDirty && hostPort && !stateSaveTimer) {
      stateSaveTimer = window.setTimeout(flushStateSave, STATE_SAVE_DELAY)
    }
  }
}

function markUserInteraction() {
  interactionGeneration += 1
}

function postStateSnapshotBestEffort() {
  if (!hostPort || !hostHydrated || !stateSaveDirty) return
  stateSaveDirty = false
  try {
    hostPort.postMessage({
      id: "panorama-unload-" + String(++requestSequence),
      method: "canvas.node.updateState",
      params: { state: snapshotState() },
      protocol: HOST_PROTOCOL,
      type: "request",
    })
  } catch {
    // The frame is already closing; no recovery path remains.
  }
}

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

function hostRequest(method, params) {
  if (!hostPort) return Promise.reject(new Error("插件尚未连接到 Convax 宿主"))
  const id = "panorama-" + String(++requestSequence)
  return new Promise(function (resolve, reject) {
    const timeout = window.setTimeout(function () {
      pendingRequests.delete(id)
      reject(new Error("宿主请求超时，请重试"))
    }, REQUEST_TIMEOUT)
    pendingRequests.set(id, {
      reject: reject,
      resolve: resolve,
      timeout: timeout,
    })
    try {
      const message = {
        id: id,
        method: method,
        protocol: HOST_PROTOCOL,
        type: "request",
      }
      if (params !== undefined) message.params = params
      hostPort.postMessage(message)
    } catch (error) {
      window.clearTimeout(timeout)
      pendingRequests.delete(id)
      reject(error)
    }
  })
}

function handleHostPortMessage(event) {
  const message = event.data
  if (!message || typeof message !== "object" || message.protocol !== HOST_PROTOCOL) return
  if (message.type === "response" && typeof message.id === "string") {
    const pending = pendingRequests.get(message.id)
    if (!pending) return
    pendingRequests.delete(message.id)
    window.clearTimeout(pending.timeout)
    if (message.ok === true) pending.resolve(message.result)
    else pending.reject(new Error(typeof message.error === "string" ? message.error : "宿主请求失败"))
    return
  }
  if (message.type !== "command" || typeof message.command !== "string") return
  if (message.command === CONNECTIONS_CHANGED_COMMAND || message.command === "panorama.refresh-connections") {
    void refreshConnectedImages(true)
  }
  if (message.command === "panorama.reset") resetView()
  if (message.command === "panorama.toggle-auto-rotate") toggleAutoRotate()
  if (message.command === "panorama.capture-viewport") void captureViewport()
}

function rejectPendingRequests(reason) {
  pendingRequests.forEach(function (pending) {
    window.clearTimeout(pending.timeout)
    pending.reject(reason)
  })
  pendingRequests.clear()
}

function handleWindowMessage(event) {
  const message = event.data
  if (
    hostPort
    || event.source !== window.parent
    || !message
    || typeof message !== "object"
    || message.protocol !== HOST_PROTOCOL
    || message.type !== "connect"
    || message.pluginId !== PLUGIN_ID
    || event.ports.length !== 1
  ) return
  hostPort = event.ports[0]
  hostPort.onmessage = handleHostPortMessage
  hostPort.start()
  window.removeEventListener("message", handleWindowMessage)
  setConnectionState(true)
  void initializeHostContext()
}

async function initializeHostContext() {
  const hydrationGeneration = interactionGeneration
  try {
    const context = await hostRequest("host.context.get")
    const metadata = context
      && context.node
      && context.node.data
      && context.node.data.metadata
    if (interactionGeneration === hydrationGeneration) {
      hydrateState(metadata && metadata.convaxPluginState)
    }
    hostHydrated = true
    if (stateSaveDirty) queueStateSave()
    await refreshConnectedImages(true)
  } catch (error) {
    hostHydrated = true
    showToast(errorMessage(error, "无法读取插件上下文"), "error")
  }
}

function normalizeConnectedImages(result) {
  if (!result || !Array.isArray(result.images)) return []
  return result.images.filter(function (image) {
    return image
      && typeof image === "object"
      && typeof image.id === "string"
      && typeof image.name === "string"
      && typeof image.readable === "boolean"
  }).map(function (image) {
    return {
      height: typeof image.height === "number" ? image.height : undefined,
      id: image.id,
      mimeType: typeof image.mimeType === "string" ? image.mimeType : undefined,
      name: image.name,
      readable: image.readable,
      width: typeof image.width === "number" ? image.width : undefined,
    }
  })
}

async function refreshConnectedImages(forceReload) {
  if (!hostPort) return
  if (refreshPromise) {
    refreshQueued = refreshQueued || forceReload
    return refreshPromise
  }
  refreshPromise = (async function () {
    try {
      const result = await hostRequest("canvas.connectedImages.list")
      connectedImages = normalizeConnectedImages(result)
      updateSourceSelect()

      if (pendingSourceIntent) {
        refreshAfterPendingLoad = true
        refreshAfterPendingLoadForce = refreshAfterPendingLoadForce || forceReload
        if (currentSource.kind === "local") updateCurrentSourceStatus()
        return
      }

      const currentConnected = currentSource.kind === "canvas"
        ? connectedImages.find(function (image) { return image.id === currentSource.nodeId && image.readable })
        : null
      const preferred = connectedImages.find(function (image) {
        return image.id === selectedSourceNodeId && image.readable
      })
      const readable = connectedImages.filter(function (image) { return image.readable })
      const fallback = readable.length ? readable[readable.length - 1] : null

      if (currentSource.kind === "local") {
        updateCurrentSourceStatus()
        return
      }

      if (currentSource.kind === "canvas" && !currentConnected) {
        clearPanorama()
        currentSource = { kind: "none" }
      }

      const target = currentConnected || preferred || fallback
      if (target && (forceReload || currentSource.kind !== "canvas" || currentSource.nodeId !== target.id)) {
        await loadConnectedImage(target)
      } else if (!target && currentSource.kind === "none") {
        setSourceStatus(connectedImages.length ? "连接图片暂不可读取" : "尚未载入")
        setEmptyMessage(
          connectedImages.length ? "连接图片无法读取" : "连接或选择一张全景图",
          connectedImages.length
            ? "请连接项目内的 JPEG、PNG 或 WebP 图片，或改用本地选图。"
            : "将画布中的图片连到此节点，或从本地选择 2:1 等距柱状投影图片。",
        )
      }

      if (connectedImages.length > 1 && target) {
        showToast("检测到 " + String(connectedImages.length) + " 张输入图片，可在底部切换。")
      }
    } catch (error) {
      showToast(errorMessage(error, "刷新画布连接失败"), "error")
    }
  })()
  try {
    await refreshPromise
  } finally {
    refreshPromise = null
    if (refreshQueued) {
      const queuedForce = refreshQueued
      refreshQueued = false
      void refreshConnectedImages(queuedForce)
    }
  }
}

function updateCurrentSourceStatus() {
  if (currentSource.kind === "local") {
    const suffix = connectedImages.length
      ? " · 已连接 " + String(connectedImages.length) + " 张画布图片"
      : ""
    setSourceStatus("本地临时图片 · " + currentSource.name + suffix)
  } else if (currentSource.kind === "canvas") {
    setSourceStatus("画布 · " + currentSource.name)
  }
}

function beginSourceLoad(intent, request) {
  const sequence = ++loadSequence
  pendingSourceIntent = intent
  pendingSourceRequest = request
  return sequence
}

function finishSourceLoad(sequence) {
  if (sequence !== loadSequence) return
  pendingSourceIntent = null
  pendingSourceRequest = null
  setLoading(false)
  if (refreshAfterPendingLoad) {
    const forceReload = refreshAfterPendingLoadForce
    refreshAfterPendingLoad = false
    refreshAfterPendingLoadForce = false
    window.queueMicrotask(function () { void refreshConnectedImages(forceReload) })
  }
}

function deferContextSource(intent) {
  const accepted = !deferredContextIntent
    || intent.userInitiated
    || !deferredContextIntent.userInitiated
  if (accepted) deferredContextIntent = intent
  return accepted
}

async function loadConnectedImage(image, options) {
  if (renderer.contextState === "lost") {
    const accepted = deferContextSource({
      image: image,
      kind: "canvas",
      userInitiated: Boolean(options && options.userInitiated),
    })
    if (accepted) setSourceStatus("WebGL 恢复后载入 · " + image.name)
    return false
  }
  const source = {
    kind: "canvas",
    name: image.name,
    nodeId: image.id,
  }
  const sequence = beginSourceLoad(source, {
    image: image,
    kind: "canvas",
    userInitiated: Boolean(options && options.userInitiated),
  })
  setLoading(true, "正在读取画布图片…")
  try {
    const result = await hostRequest("canvas.connectedImage.read", { nodeId: image.id })
    if (sequence !== loadSequence) return false
    if (!result || typeof result.dataUrl !== "string" || typeof result.mimeType !== "string") {
      throw new Error("宿主没有返回可用图片")
    }
    const inspected = inspectDataUrlImage(result.dataUrl, result.mimeType, result.size)
    source.name = typeof result.name === "string" ? result.name : image.name
    await loadPanoramaSource(
      new Blob([inspected.bytes], { type: inspected.mimeType }),
      source,
      sequence,
      inspected.dimensions,
    )
    if (sequence !== loadSequence) return false
    currentLocalFile = null
    selectedSourceNodeId = image.id
    updateSourceSelect()
    queueStateSave()
    return true
  } catch (error) {
    if (sequence === loadSequence) {
      const message = errorMessage(error, "画布图片载入失败")
      showToast(message, "error")
      updateSourceSelect()
      if (!renderer.texture) {
        setPersistentViewerError("无法载入连接图片", message)
      }
    }
    if (options && options.rethrow) throw error
    return false
  } finally {
    finishSourceLoad(sequence)
  }
}

async function loadLocalFile(file, options) {
  if (!file || !ACCEPTED_IMAGE_TYPES.has(file.type)) {
    showToast("请选择 JPEG、PNG 或 WebP 图片。", "error")
    return false
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_IMAGE_FILE_BYTES) {
    showToast("本地图片必须小于或等于 16 MiB。", "error")
    return false
  }
  if (renderer.contextState === "lost") {
    const accepted = deferContextSource({
      file: file,
      kind: "local",
      userInitiated: Boolean(options && options.userInitiated),
    })
    if (accepted) setSourceStatus("WebGL 恢复后载入 · " + file.name)
    return false
  }
  const source = { kind: "local", name: file.name }
  const sequence = beginSourceLoad(source, {
    file: file,
    kind: "local",
    userInitiated: Boolean(options && options.userInitiated),
  })
  setLoading(true, "正在解码本地图片…")
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (sequence !== loadSequence) return false
    const dimensions = inspectImageBytes(bytes, file.type)
    await loadPanoramaSource(file, source, sequence, dimensions)
    if (sequence !== loadSequence) return false
    currentLocalFile = file
    updateSourceSelect()
    queueStateSave()
    return true
  } catch (error) {
    if (sequence === loadSequence) {
      const message = errorMessage(error, "本地图片载入失败")
      showToast(message, "error")
      updateSourceSelect()
      if (!renderer.texture) setPersistentViewerError("无法载入本地图片", message)
    }
    if (options && options.rethrow) throw error
    return false
  } finally {
    finishSourceLoad(sequence)
  }
}

async function loadPanoramaSource(blob, source, sequence, dimensions) {
  const decoded = await decodePanoramaImage(blob, dimensions, renderer.gl)
  if (sequence !== loadSequence) {
    decoded.bitmap.close()
    return
  }
  try {
    renderer.uploadTexture(decoded.bitmap)
  } finally {
    decoded.bitmap.close()
  }
  renderer.contextState = "ready"
  updateCaptureControl()
  currentSource = source
  updateCurrentSourceStatus()
  setEmptyMessage("连接或选择一张全景图", "将画布中的图片连到此节点，或从本地选择 2:1 等距柱状投影图片。")
  updateImageMeta(dimensions.width, dimensions.height)
  elements.viewer.classList.add("has-image")
  setHidden(elements.interactionHint, false)
  window.clearTimeout(lastInteractionHintTimer)
  lastInteractionHintTimer = window.setTimeout(function () {
    setHidden(elements.interactionHint, true)
  }, 3200)
  if (decoded.target.width !== dimensions.width || decoded.target.height !== dimensions.height) {
    showToast("图片已按 GPU 预算缩放到 " + String(decoded.target.width) + " × " + String(decoded.target.height) + "。", "warning")
  } else if (Math.abs(dimensions.ratio - 2) > 0.04) {
    showToast("图片比例为 " + dimensions.ratio.toFixed(2) + ":1，预览可能出现轻微拉伸。", "warning")
  }
  scheduleRender()
}

function setPersistentViewerError(title, description) {
  renderer.contextState = "failed"
  updateCaptureControl()
  elements.viewer.classList.remove("has-image")
  setHidden(elements.interactionHint, true)
  clearImageMeta()
  setEmptyMessage(title, description)
  setSourceStatus("载入失败")
}

function clearPanorama() {
  loadSequence += 1
  renderer.clearTexture()
  updateCaptureControl()
  elements.viewer.classList.remove("has-image")
  setHidden(elements.interactionHint, true)
  clearImageMeta()
}

function blobDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader()
    reader.addEventListener("load", function () {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("截图数据读取失败"))
    }, { once: true })
    reader.addEventListener("error", function () {
      reject(reader.error || new Error("截图数据读取失败"))
    }, { once: true })
    reader.readAsDataURL(blob)
  })
}

async function captureViewport() {
  if (captureInFlight) return
  if (!renderer.texture || renderer.contextState !== "ready") {
    showToast("请先载入全景图后再截取画面。", "warning")
    return
  }
  captureInFlight = true
  updateCaptureControl()
  setLoading(true, "正在截取当前画面…")
  try {
    const blob = await renderer.capture(viewState)
    const dataUrl = await blobDataUrl(blob)
    await hostRequest("canvas.image.create", {
      dataUrl: dataUrl,
      name: "全景视口截图.png",
    })
    showToast("已在画布中创建当前视口截图。")
  } catch (error) {
    showToast(errorMessage(error, "当前画面截取失败"), "error")
  } finally {
    captureInFlight = false
    updateCaptureControl()
    setLoading(false)
  }
}

function scheduleRender() {
  if (animationFrame) return
  animationFrame = window.requestAnimationFrame(frame)
}

function frame(timestamp) {
  animationFrame = 0
  const delta = lastFrameTime ? Math.min(50, timestamp - lastFrameTime) : 0
  lastFrameTime = timestamp
  if (
    viewState.autoRotate
    && !pointer
    && renderer.texture
    && document.visibilityState === "visible"
  ) {
    viewState.yawDeg = normalizeYaw(
      viewState.yawDeg + AUTO_ROTATE_DEGREES_PER_SECOND * delta / 1000,
    )
  }
  renderer.render(viewState)
  if (viewState.autoRotate && renderer.texture && document.visibilityState === "visible") {
    scheduleRender()
  }
}

function resetView() {
  markUserInteraction()
  viewState.yawDeg = 0
  viewState.pitchDeg = 0
  viewState.fovDeg = 75
  updateViewControls()
  queueStateSave()
  scheduleRender()
}

function toggleAutoRotate() {
  markUserInteraction()
  viewState.autoRotate = !viewState.autoRotate
  updateViewControls()
  queueStateSave()
  lastFrameTime = 0
  scheduleRender()
}

function handlePointerDown(event) {
  if (!renderer.texture || event.button !== 0) return
  markUserInteraction()
  pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  }
  elements.viewer.classList.add("is-dragging")
  elements.viewer.setPointerCapture(event.pointerId)
  setHidden(elements.interactionHint, true)
}

function handlePointerMove(event) {
  if (!pointer || pointer.id !== event.pointerId) return
  const deltaX = event.clientX - pointer.x
  const deltaY = event.clientY - pointer.y
  pointer.x = event.clientX
  pointer.y = event.clientY
  const sensitivity = viewState.fovDeg / 75
  viewState.yawDeg = normalizeYaw(viewState.yawDeg - deltaX * 0.16 * sensitivity)
  viewState.pitchDeg = clamp(viewState.pitchDeg + deltaY * 0.14 * sensitivity, -MAX_PITCH, MAX_PITCH)
  scheduleRender()
}

function handlePointerEnd(event) {
  if (!pointer || pointer.id !== event.pointerId) return
  pointer = null
  elements.viewer.classList.remove("is-dragging")
  if (elements.viewer.hasPointerCapture(event.pointerId)) elements.viewer.releasePointerCapture(event.pointerId)
  queueStateSave()
  void flushStateSave()
  lastFrameTime = 0
  scheduleRender()
}

function cancelPointerInteraction() {
  if (!pointer) return
  pointer = null
  elements.viewer.classList.remove("is-dragging")
  queueStateSave()
  void flushStateSave()
  lastFrameTime = 0
  scheduleRender()
}

function handleWheel(event) {
  if (!renderer.texture) return
  event.preventDefault()
  markUserInteraction()
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? elements.viewer.clientHeight
      : 1
  const delta = clamp(event.deltaY * unit * 0.03, -6, 6)
  viewState.fovDeg = clamp(viewState.fovDeg + delta, MIN_FOV, MAX_FOV)
  updateViewControls()
  queueStateSave()
  scheduleRender()
}

function openFilePicker() {
  elements.fileInput.click()
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch (error) {
    showToast(errorMessage(error, "宿主或系统未允许全屏预览"), "error")
  }
}

function handleDragEnter(event) {
  event.preventDefault()
  dragDepth += 1
  setHidden(elements.dragHint, false)
}

function handleDragLeave(event) {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) setHidden(elements.dragHint, true)
}

function handleDrop(event) {
  event.preventDefault()
  dragDepth = 0
  setHidden(elements.dragHint, true)
  const files = Array.from(event.dataTransfer.files || [])
  const image = files.find(function (file) { return ACCEPTED_IMAGE_TYPES.has(file.type) })
  if (!image) {
    showToast("拖入内容中没有可用的 JPEG、PNG 或 WebP 图片。", "error")
    return
  }
  markUserInteraction()
  void loadLocalFile(image, { userInitiated: true })
}

async function restoreRenderer() {
  renderer.contextState = "restoring"
  setLoading(true, "正在恢复 WebGL 预览…")
  setSourceStatus("渲染器恢复中")
  try {
    renderer.initialize()
    const deferred = deferredContextIntent
    deferredContextIntent = null
    if (deferred?.kind === "canvas") {
      await loadConnectedImage(deferred.image, {
        rethrow: true,
        userInitiated: deferred.userInitiated,
      })
    } else if (deferred?.kind === "local") {
      await loadLocalFile(deferred.file, {
        rethrow: true,
        userInitiated: deferred.userInitiated,
      })
    } else if (currentSource.kind === "canvas") {
      const image = connectedImages.find(function (candidate) {
        return candidate.id === currentSource.nodeId && candidate.readable
      })
      if (!image) throw new Error("原画布图片已断开，无法恢复预览")
      await loadConnectedImage(image, { rethrow: true })
    } else if (currentSource.kind === "local" && currentLocalFile) {
      await loadLocalFile(currentLocalFile, { rethrow: true })
    } else {
      renderer.contextState = "ready"
      setLoading(false)
      setSourceStatus("尚未载入")
      setEmptyMessage(
        "连接或选择一张全景图",
        "将画布中的图片连到此节点，或从本地选择 2:1 等距柱状投影图片。",
      )
    }
  } catch (error) {
    const message = errorMessage(error, "WebGL 恢复失败")
    setLoading(false)
    setPersistentViewerError("WebGL 预览恢复失败", message)
    showToast(message, "error")
  }
}

function bindEvents() {
  window.addEventListener("message", handleWindowMessage)
  window.addEventListener("beforeunload", function () {
    postStateSnapshotBestEffort()
    window.clearTimeout(stateSaveTimer)
    window.clearTimeout(toastTimer)
    window.clearTimeout(lastInteractionHintTimer)
    if (animationFrame) window.cancelAnimationFrame(animationFrame)
    rejectPendingRequests(new Error("插件页面已关闭"))
    if (hostPort) {
      hostPort.onmessage = null
      hostPort.close()
      hostPort = null
    }
    renderer.clearTexture()
  })
  document.addEventListener("fullscreenchange", updateFullscreenControls)
  document.addEventListener("visibilitychange", function () {
    lastFrameTime = 0
    if (document.visibilityState === "visible") scheduleRender()
    else void flushStateSave()
  })
  window.addEventListener("blur", cancelPointerInteraction)
  elements.emptyChooseButton.addEventListener("click", openFilePicker)
  elements.chooseButton.addEventListener("click", openFilePicker)
  elements.fileInput.addEventListener("change", function () {
    const file = elements.fileInput.files && elements.fileInput.files[0]
    elements.fileInput.value = ""
    if (file) {
      markUserInteraction()
      void loadLocalFile(file, { userInitiated: true })
    }
  })
  elements.refreshButton.addEventListener("click", function () {
    void refreshConnectedImages(true)
  })
  elements.captureButton.addEventListener("click", function () {
    void captureViewport()
  })
  elements.resetButton.addEventListener("click", resetView)
  elements.autoRotateButton.addEventListener("click", toggleAutoRotate)
  elements.fullscreenButton.addEventListener("click", function () {
    void toggleFullscreen()
  })
  elements.fovRange.addEventListener("input", function () {
    markUserInteraction()
    viewState.fovDeg = clamp(Number(elements.fovRange.value), MIN_FOV, MAX_FOV)
    updateViewControls()
    queueStateSave()
    scheduleRender()
  })
  elements.fovRange.addEventListener("change", function () { void flushStateSave() })
  elements.sourceSelect.addEventListener("change", function () {
    const image = connectedImages.find(function (candidate) {
      return candidate.id === elements.sourceSelect.value && candidate.readable
    })
    if (image) {
      markUserInteraction()
      void loadConnectedImage(image, { userInitiated: true })
    }
  })
  elements.viewer.addEventListener("pointerdown", handlePointerDown)
  elements.viewer.addEventListener("pointermove", handlePointerMove)
  elements.viewer.addEventListener("pointerup", handlePointerEnd)
  elements.viewer.addEventListener("pointercancel", handlePointerEnd)
  elements.viewer.addEventListener("lostpointercapture", cancelPointerInteraction)
  elements.viewer.addEventListener("wheel", handleWheel, { passive: false })
  elements.viewer.addEventListener("dragenter", handleDragEnter)
  elements.viewer.addEventListener("dragover", function (event) { event.preventDefault() })
  elements.viewer.addEventListener("dragleave", handleDragLeave)
  elements.viewer.addEventListener("drop", handleDrop)
  elements.canvas.addEventListener("webglcontextlost", function (event) {
    event.preventDefault()
    if (pendingSourceRequest) deferContextSource(pendingSourceRequest)
    loadSequence += 1
    pendingSourceIntent = null
    pendingSourceRequest = null
    refreshAfterPendingLoad = false
    refreshAfterPendingLoadForce = false
    renderer.contextState = "lost"
    renderer.ready = false
    renderer.texture = null
    updateCaptureControl()
    elements.viewer.classList.remove("has-image")
    setHidden(elements.interactionHint, true)
    clearImageMeta()
    setEmptyMessage("WebGL 上下文已丢失", "正在等待图形系统恢复；恢复成功后会自动重新载入当前全景图。")
    setSourceStatus("渲染器恢复中")
    setLoading(true, "等待 WebGL 恢复…")
    showToast("WebGL 上下文已丢失，正在等待恢复。", "error")
  })
  elements.canvas.addEventListener("webglcontextrestored", function () {
    void restoreRenderer()
  })
  const resizeObserver = new ResizeObserver(renderer.resize)
  resizeObserver.observe(elements.viewer)
}

function boot() {
  bindEvents()
  updateViewControls()
  updateFullscreenControls()
  setConnectionState(false)
  setSourceStatus("尚未载入")
  try {
    renderer.initialize()
    renderer.render(viewState)
  } catch (error) {
    setEmptyMessage("WebGL2 不可用", errorMessage(error, "无法初始化全景渲染器"))
    elements.chooseButton.disabled = true
    elements.emptyChooseButton.disabled = true
    showToast(errorMessage(error, "无法初始化 WebGL2"), "error")
  }
}

boot()
