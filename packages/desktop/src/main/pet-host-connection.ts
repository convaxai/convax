import { Buffer } from "node:buffer"

import type { WebPluginCapability } from "../plugin-contracts"
import {
  petHostMaximumMessageBytes,
  petHostMaximumPendingRequests,
  petHostProtocol,
  type PetActivitySnapshot,
  type PetDragInput,
  type PetHostEvent,
  type PetHostMessage,
  type PetHostMethod,
  type PetHostProviderBinding,
  type PetHostRequest,
  type PetHostSurface,
  type PetNavigationRequest,
  type PetPreferences,
  type PetPreferencesUpdate,
} from "../pet-contracts"

type Awaitable<T> = Promise<T> | T
type Unsubscribe = () => void

export interface PetHostServices {
  getActivitySnapshot(): Awaitable<PetActivitySnapshot>
  getBinding(): PetHostProviderBinding | undefined
  getPreferences(): Awaitable<PetPreferences>
  moveOverlay(input: PetDragInput): Awaitable<unknown>
  openActivity(input: PetNavigationRequest): Awaitable<unknown>
  setAwake(input: { awake: boolean }): Awaitable<PetPreferences>
  setExpanded(input: { expanded: boolean }): Awaitable<unknown>
  subscribeActivity(listener: (snapshot: PetActivitySnapshot) => void): Unsubscribe
  subscribePreferences?(listener: (preferences: PetPreferences) => void): Unsubscribe
  updatePreferences(input: PetPreferencesUpdate): Awaitable<PetPreferences>
}

export interface PetHostConnectionOptions {
  binding: PetHostProviderBinding
  send(message: PetHostMessage): void
  services: PetHostServices
  surface: PetHostSurface
}

const overlayMethods = new Set<PetHostMethod>([
  "activity.getSnapshot",
  "activity.open",
  "overlay.move",
  "overlay.setExpanded",
  "preferences.get",
  "preferences.update",
])
const settingsMethods = new Set<PetHostMethod>(["lifecycle.setAwake", "preferences.get", "preferences.update"])
const knownMethods = new Set<PetHostMethod>([...overlayMethods, ...settingsMethods])
const requiredCapabilities = new Map<PetHostMethod, WebPluginCapability>([
  ["activity.getSnapshot", "pet.activity.read"],
  ["activity.open", "pet.activity.open"],
  ["preferences.get", "pet.preferences.write"],
  ["preferences.update", "pet.preferences.write"],
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function isBoundedMessage(value: unknown) {
  try {
    const text = JSON.stringify(value)
    return text !== undefined && Buffer.byteLength(text, "utf8") <= petHostMaximumMessageBytes
  } catch {
    return false
  }
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function isRequestId(value: unknown): value is string {
  return isBoundedText(value, 80)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function sameBinding(left: PetHostProviderBinding, right: PetHostProviderBinding | undefined) {
  return (
    right !== undefined &&
    left.pluginId === right.pluginId &&
    left.digest === right.digest &&
    left.generation === right.generation &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((capability, index) => capability === right.capabilities[index])
  )
}

function emptyParams(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, [])) throw new Error("Pet host method requires empty params")
  return {}
}

function activityOpenParams(value: unknown): PetNavigationRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["activityId", "revision"])) {
    throw new Error("activity.open params are invalid")
  }
  if (!isBoundedText(value.activityId, 200)) throw new Error("activity.open activityId is invalid")
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error("activity.open revision is invalid")
  }
  return { activityId: value.activityId, revision: value.revision as number }
}

function preferencesUpdateParams(value: unknown): PetPreferencesUpdate {
  if (!isRecord(value) || !hasExactKeys(value, ["selectedPetId"])) {
    throw new Error("preferences.update params are invalid")
  }
  if (!isBoundedText(value.selectedPetId, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.selectedPetId)) {
    throw new Error("preferences.update selectedPetId is invalid")
  }
  return { selectedPetId: value.selectedPetId }
}

function overlayMoveParams(value: unknown): PetDragInput {
  if (!isRecord(value) || !hasExactKeys(value, ["dx", "dy", "phase"])) {
    throw new Error("overlay.move params are invalid")
  }
  if (
    typeof value.dx !== "number" ||
    !Number.isFinite(value.dx) ||
    Math.abs(value.dx) > 100_000 ||
    typeof value.dy !== "number" ||
    !Number.isFinite(value.dy) ||
    Math.abs(value.dy) > 100_000 ||
    (value.phase !== "end" && value.phase !== "move")
  ) {
    throw new Error("overlay.move params are invalid")
  }
  return { dx: value.dx, dy: value.dy, phase: value.phase }
}

function booleanParams<K extends "awake" | "expanded">(value: unknown, key: K): Record<K, boolean> {
  if (!isRecord(value) || !hasExactKeys(value, [key]) || typeof value[key] !== "boolean") {
    throw new Error(`Pet host ${key} params are invalid`)
  }
  return { [key]: value[key] } as Record<K, boolean>
}

interface ParsedEnvelope {
  id: string
  method: PetHostMethod
  params: unknown
}

function parseEnvelope(value: Record<string, unknown>): ParsedEnvelope {
  if (!isBoundedMessage(value)) throw new Error("Pet host message exceeds the size limit")
  if (!hasExactKeys(value, ["id", "method", "params", "protocol", "type"])) {
    throw new Error("Pet host request envelope is invalid")
  }
  if (value.protocol !== petHostProtocol || value.type !== "request") {
    throw new Error("Pet host request protocol is invalid")
  }
  if (!isBoundedText(value.method, 80) || !knownMethods.has(value.method as PetHostMethod)) {
    throw new Error("Pet host method is not supported")
  }
  return { id: value.id as string, method: value.method as PetHostMethod, params: value.params }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Pet host request failed"
  return message.slice(0, 500) || "Pet host request failed"
}

function failureResponse(id: string, error: string) {
  return { error: error.slice(0, 500), id, ok: false as const, protocol: petHostProtocol, type: "response" as const }
}

export class PetHostConnection {
  readonly #binding: PetHostProviderBinding
  readonly #pending = new Set<string>()
  readonly #send: PetHostConnectionOptions["send"]
  readonly #services: PetHostServices
  readonly #surface: PetHostSurface
  readonly #unsubscribers: Unsubscribe[] = []
  #closed = false

  constructor(options: PetHostConnectionOptions) {
    this.#binding = Object.freeze({
      capabilities: Object.freeze([...options.binding.capabilities]),
      digest: options.binding.digest,
      generation: options.binding.generation,
      pluginId: options.binding.pluginId,
    })
    this.#send = options.send
    this.#services = options.services
    this.#surface = options.surface

    if (options.surface === "overlay" && this.#hasCapability("pet.activity.read")) {
      this.#unsubscribers.push(
        options.services.subscribeActivity((snapshot) => this.#emit("activity.changed", snapshot)),
      )
    }
    if (this.#hasCapability("pet.preferences.write") && options.services.subscribePreferences) {
      this.#unsubscribers.push(
        options.services.subscribePreferences((preferences) => this.#emit("preferences.changed", preferences)),
      )
    }
  }

  async handle(message: unknown): Promise<void> {
    if (this.#closed || !isRecord(message) || !isRequestId(message.id)) return
    const id = message.id
    let envelope: ParsedEnvelope
    try {
      envelope = parseEnvelope(message)
      this.#assertAllowed(envelope.method)
      this.#assertCapability(envelope.method)
    } catch (error) {
      this.#sendFailure(id, errorMessage(error))
      return
    }

    const initialBinding = this.#bindingStatus()
    if (!initialBinding.current) {
      this.#sendFailure(id, initialBinding.reason)
      this.close(initialBinding.reason)
      return
    }
    if (this.#pending.has(id)) {
      this.#sendFailure(id, "Pet host request id is already pending")
      return
    }
    if (this.#pending.size >= petHostMaximumPendingRequests) {
      this.#sendFailure(id, "Pet host pending request limit reached")
      return
    }

    this.#pending.add(id)
    try {
      const result = await this.#dispatch(envelope.method, envelope.params)
      if (this.#closed) return
      const completedBinding = this.#bindingStatus()
      if (!completedBinding.current) {
        this.close(completedBinding.reason)
        return
      }
      this.#sendSuccess(id, result)
    } catch (error) {
      if (!this.#closed) this.#sendFailure(id, errorMessage(error))
    } finally {
      this.#pending.delete(id)
    }
  }

  close(reason = "Pet host connection closed"): void {
    if (this.#closed) return
    const pending = [...this.#pending]
    this.#finishClose()
    for (const id of pending) {
      try {
        this.#send(failureResponse(id, reason))
      } catch {
        break
      }
    }
  }

  #finishClose() {
    if (this.#closed) return
    this.#pending.clear()
    this.#closed = true
    for (const unsubscribe of this.#unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch {}
    }
  }

  #assertAllowed(method: PetHostMethod) {
    const allowed = this.#surface === "overlay" ? overlayMethods : settingsMethods
    if (!allowed.has(method)) throw new Error(`Pet host method is not allowed for ${this.#surface}`)
  }

  #assertCapability(method: PetHostMethod) {
    const required = requiredCapabilities.get(method)
    if (required && !this.#hasCapability(required)) {
      throw new Error(`Plugin capability is not granted: ${required}`)
    }
  }

  async #dispatch(method: PetHostMethod, params: unknown): Promise<unknown> {
    switch (method) {
      case "activity.getSnapshot":
        emptyParams(params)
        return this.#services.getActivitySnapshot()
      case "activity.open":
        return this.#services.openActivity(activityOpenParams(params))
      case "preferences.get":
        emptyParams(params)
        return this.#services.getPreferences()
      case "preferences.update":
        return this.#services.updatePreferences(preferencesUpdateParams(params))
      case "overlay.move":
        return this.#services.moveOverlay(overlayMoveParams(params))
      case "overlay.setExpanded":
        return this.#services.setExpanded(booleanParams(params, "expanded"))
      case "lifecycle.setAwake":
        return this.#services.setAwake(booleanParams(params, "awake"))
    }
  }

  #emit(event: PetHostEvent["event"], payload: PetActivitySnapshot | PetPreferences) {
    if (this.#closed) return
    const binding = this.#bindingStatus()
    if (!binding.current) {
      this.close(binding.reason)
      return
    }
    let message: PetHostEvent
    try {
      message = { event, payload: clone(payload), protocol: petHostProtocol, type: "event" } as PetHostEvent
    } catch {
      this.close("Pet host event cannot be cloned")
      return
    }
    if (!isBoundedMessage(message)) {
      this.close("Pet host event exceeds the size limit")
      return
    }
    this.#sendMessage(message)
  }

  #hasCapability(capability: WebPluginCapability) {
    return this.#binding.capabilities.includes(capability)
  }

  #bindingStatus(): { current: true } | { current: false; reason: string } {
    try {
      return sameBinding(this.#binding, this.#services.getBinding())
        ? { current: true }
        : { current: false, reason: "Pet provider changed" }
    } catch {
      return { current: false, reason: "Pet provider binding is unavailable" }
    }
  }

  #sendFailure(id: string, error: string) {
    this.#sendMessage(failureResponse(id, error))
  }

  #sendMessage(message: PetHostMessage) {
    if (this.#closed) return
    try {
      this.#send(message)
    } catch {
      this.#finishClose()
    }
  }

  #sendSuccess(id: string, value: unknown) {
    let result: unknown
    try {
      result = clone(value)
    } catch {
      this.#sendFailure(id, "Pet host result cannot be cloned")
      return
    }
    const message = { id, ok: true, protocol: petHostProtocol, result, type: "response" } as const
    if (!isBoundedMessage(message)) {
      this.#sendFailure(id, "Pet host result exceeds the size limit")
      return
    }
    this.#sendMessage(message)
  }
}

export type { PetHostRequest }
