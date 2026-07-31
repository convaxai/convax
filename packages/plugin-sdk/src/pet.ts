/** Public, contribution-scoped Pet surface protocol shared by the Host and Plugin authors. */
export const petHostProtocol = "convax.pet-host/1" as const
export const petHostMaximumMessageBytes = 64 * 1024
export const petHostMaximumPendingRequests = 64

export type PetHostSurface = "overlay" | "settings"
export type PetVisibleActivityState = "needs-input" | "blocked" | "ready" | "running"

export interface PetActivitySummary {
  id: string
  input?: "permission" | "question"
  projectId: string
  projectName: string
  sessionId: string
  sessionName: string
  state: PetVisibleActivityState
  updatedAt: number
}

export interface PetActivitySnapshot {
  activities: PetActivitySummary[]
  revision: number
}

export interface PetPreferences {
  awake: boolean
  selectedPetId?: string
}

export interface PetPreferencesUpdate {
  selectedPetId: string
}

export interface PetCustomPet {
  alt: string
  description: string
  displayName: string
  id: string
  source: "custom"
  spritesheetUrl: string
  spriteVersion: 2
}

export interface PetCustomCollectionSnapshot {
  pets: PetCustomPet[]
  revision: number
}

export interface PetCustomDelete {
  petId: string
}

export interface PetNavigationRequest {
  activityId: string
  revision: number
}

export interface PetDragInput {
  phase: "end" | "move" | "start"
  screenX: number
  screenY: number
  sequence: number
  session: string
}

export interface PetHostMethodContract {
  readonly "activity.getSnapshot": {
    readonly params: Record<string, never>
    readonly result: PetActivitySnapshot
  }
  readonly "activity.open": { readonly params: PetNavigationRequest; readonly result: unknown }
  readonly "collection.delete": { readonly params: PetCustomDelete; readonly result: PetCustomCollectionSnapshot }
  readonly "collection.get": {
    readonly params: Record<string, never>
    readonly result: PetCustomCollectionSnapshot
  }
  readonly "collection.import": { readonly params: Record<string, never>; readonly result: PetCustomPet | null }
  readonly "lifecycle.setAwake": { readonly params: { readonly awake: boolean }; readonly result: PetPreferences }
  readonly "overlay.move": { readonly params: PetDragInput; readonly result: unknown }
  readonly "overlay.setExpanded": { readonly params: { readonly expanded: boolean }; readonly result: unknown }
  readonly "preferences.get": { readonly params: Record<string, never>; readonly result: PetPreferences }
  readonly "preferences.update": { readonly params: PetPreferencesUpdate; readonly result: PetPreferences }
}

export type PetHostMethod = keyof PetHostMethodContract
export type PetHostMethodForSurface<Surface extends PetHostSurface> = Surface extends "overlay"
  ?
      | "activity.getSnapshot"
      | "activity.open"
      | "collection.get"
      | "overlay.move"
      | "overlay.setExpanded"
      | "preferences.get"
      | "preferences.update"
  :
      | "collection.delete"
      | "collection.get"
      | "collection.import"
      | "lifecycle.setAwake"
      | "preferences.get"
      | "preferences.update"
export type PetHostParams<Method extends PetHostMethod> = PetHostMethodContract[Method]["params"]
export type PetHostResult<Method extends PetHostMethod> = PetHostMethodContract[Method]["result"]

const petHostOverlayMethods = new Set<PetHostMethod>([
  "activity.getSnapshot",
  "activity.open",
  "collection.get",
  "overlay.move",
  "overlay.setExpanded",
  "preferences.get",
  "preferences.update",
])

const petHostSettingsMethods = new Set<PetHostMethod>([
  "collection.delete",
  "collection.get",
  "collection.import",
  "lifecycle.setAwake",
  "preferences.get",
  "preferences.update",
])

export function isPetHostMethodForSurface<Surface extends PetHostSurface>(
  surface: Surface,
  method: unknown,
): method is PetHostMethodForSurface<Surface> {
  if (typeof method !== "string") return false
  return (surface === "overlay" ? petHostOverlayMethods : petHostSettingsMethods).has(method as PetHostMethod)
}

interface PetHostRequestBase {
  readonly id: string
  readonly protocol: typeof petHostProtocol
  readonly type: "request"
}

export type PetHostRequest = {
  readonly [Method in PetHostMethod]: PetHostRequestBase & {
    readonly method: Method
    readonly params: PetHostParams<Method>
  }
}[PetHostMethod]

export type PetHostResponse =
  | {
      readonly id: string
      readonly ok: true
      readonly protocol: typeof petHostProtocol
      readonly result: unknown
      readonly type: "response"
    }
  | {
      readonly error: string
      readonly id: string
      readonly ok: false
      readonly protocol: typeof petHostProtocol
      readonly type: "response"
    }

export interface PetHostEventContract {
  readonly "activity.changed": PetActivitySnapshot
  readonly "collection.changed": PetCustomCollectionSnapshot
  readonly "preferences.changed": PetPreferences
}

export type PetHostEventName = keyof PetHostEventContract
export type PetHostEventPayload<Event extends PetHostEventName> = PetHostEventContract[Event]
export type PetHostEvent = {
  readonly [Event in PetHostEventName]: {
    readonly event: Event
    readonly payload: PetHostEventPayload<Event>
    readonly protocol: typeof petHostProtocol
    readonly type: "event"
  }
}[PetHostEventName]
export type PetHostMessage = PetHostEvent | PetHostResponse

export interface PetHostOverlayConnect {
  readonly pluginId: string
  readonly protocol: typeof petHostProtocol
  readonly surface: "overlay"
  readonly type: "connect"
}

export interface PetHostSettingsConnect {
  readonly connectionId: string
  readonly generation: number
  readonly pluginId: string
  readonly protocol: typeof petHostProtocol
  readonly surface: "settings"
  readonly type: "connect"
}

export type PetHostConnect = PetHostOverlayConnect | PetHostSettingsConnect

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : undefined
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function pluginId(value: unknown): value is string {
  return text(value, 80) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)
}

function safeRevision(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function emptyParams(value: unknown) {
  const object = record(value)
  if (!object || !hasExactKeys(object, [])) throw new TypeError("Pet Host method requires empty params")
  return object as Record<string, never>
}

export function parsePetHostParams<Method extends PetHostMethod>(
  method: Method,
  value: unknown,
): PetHostParams<Method> {
  const object = record(value)
  switch (method) {
    case "activity.getSnapshot":
    case "collection.get":
    case "collection.import":
    case "preferences.get":
      return emptyParams(value) as PetHostParams<Method>
    case "activity.open":
      if (
        !object ||
        !hasExactKeys(object, ["activityId", "revision"]) ||
        !text(object.activityId, 200) ||
        !safeRevision(object.revision)
      ) {
        throw new TypeError("Pet activity.open params are invalid")
      }
      return value as PetHostParams<Method>
    case "collection.delete":
      if (
        !object ||
        !hasExactKeys(object, ["petId"]) ||
        !text(object.petId, 80) ||
        !/^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(object.petId)
      ) {
        throw new TypeError("Pet collection.delete params are invalid")
      }
      return value as PetHostParams<Method>
    case "lifecycle.setAwake":
      if (!object || !hasExactKeys(object, ["awake"]) || typeof object.awake !== "boolean") {
        throw new TypeError("Pet lifecycle.setAwake params are invalid")
      }
      return value as PetHostParams<Method>
    case "overlay.setExpanded":
      if (!object || !hasExactKeys(object, ["expanded"]) || typeof object.expanded !== "boolean") {
        throw new TypeError("Pet overlay.setExpanded params are invalid")
      }
      return value as PetHostParams<Method>
    case "preferences.update":
      if (!object || !hasExactKeys(object, ["selectedPetId"]) || !pluginId(object.selectedPetId)) {
        throw new TypeError("Pet preferences.update params are invalid")
      }
      return value as PetHostParams<Method>
    case "overlay.move":
      if (
        !object ||
        !hasExactKeys(object, ["phase", "screenX", "screenY", "sequence", "session"]) ||
        (object.phase !== "start" && object.phase !== "move" && object.phase !== "end") ||
        typeof object.screenX !== "number" ||
        !Number.isFinite(object.screenX) ||
        Math.abs(object.screenX) > 1_000_000 ||
        typeof object.screenY !== "number" ||
        !Number.isFinite(object.screenY) ||
        Math.abs(object.screenY) > 1_000_000 ||
        !safeRevision(object.sequence) ||
        !text(object.session, 80) ||
        !/^[A-Za-z0-9-]+$/u.test(object.session)
      ) {
        throw new TypeError("Pet overlay.move params are invalid")
      }
      return value as PetHostParams<Method>
    default:
      throw new TypeError("Pet Host method is invalid")
  }
}

function utf8Length(value: string) {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit <= 0x7f) bytes += 1
    else if (unit <= 0x7ff) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const trail = value.charCodeAt(index + 1)
      if (trail >= 0xdc00 && trail <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

export function isPetHostMessageWithinLimit(value: unknown) {
  try {
    const serialized = JSON.stringify(value)
    return serialized !== undefined && utf8Length(serialized) <= petHostMaximumMessageBytes
  } catch {
    return false
  }
}

function parseActivitySummary(value: unknown): PetActivitySummary {
  const object = record(value)
  if (!object) throw new TypeError("Pet activity is invalid")
  const required = ["id", "projectId", "projectName", "sessionId", "sessionName", "state", "updatedAt"]
  const keys = object.input === undefined ? required : [...required, "input"]
  if (
    !hasExactKeys(object, keys) ||
    !text(object.id, 200) ||
    !text(object.projectId, 200) ||
    !text(object.projectName, 500) ||
    !text(object.sessionId, 200) ||
    !text(object.sessionName, 500) ||
    !["needs-input", "blocked", "ready", "running"].includes(object.state as string) ||
    !Number.isFinite(object.updatedAt) ||
    (object.input !== undefined && object.input !== "permission" && object.input !== "question")
  ) {
    throw new TypeError("Pet activity is invalid")
  }
  return value as PetActivitySummary
}

export function parsePetActivitySnapshot(value: unknown): PetActivitySnapshot {
  const object = record(value)
  if (!object || !hasExactKeys(object, ["activities", "revision"]) || !Array.isArray(object.activities)) {
    throw new TypeError("Pet activity snapshot is invalid")
  }
  if (!safeRevision(object.revision) || object.activities.length > 512) {
    throw new TypeError("Pet activity snapshot is invalid")
  }
  object.activities.forEach(parseActivitySummary)
  return value as PetActivitySnapshot
}

export function parsePetPreferences(value: unknown): PetPreferences {
  const object = record(value)
  if (!object) throw new TypeError("Pet preferences are invalid")
  const keys = object.selectedPetId === undefined ? ["awake"] : ["awake", "selectedPetId"]
  if (
    !hasExactKeys(object, keys) ||
    typeof object.awake !== "boolean" ||
    (object.selectedPetId !== undefined && !pluginId(object.selectedPetId))
  ) {
    throw new TypeError("Pet preferences are invalid")
  }
  return value as PetPreferences
}

export function parsePetCustomPet(value: unknown): PetCustomPet {
  const object = record(value)
  if (
    !object ||
    !hasExactKeys(object, ["alt", "description", "displayName", "id", "source", "spritesheetUrl", "spriteVersion"]) ||
    !text(object.alt, 500) ||
    !text(object.description, 2_000) ||
    !text(object.displayName, 120) ||
    !text(object.id, 80) ||
    !/^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(object.id as string) ||
    object.source !== "custom" ||
    !text(object.spritesheetUrl, 2_048) ||
    object.spriteVersion !== 2
  ) {
    throw new TypeError("Custom Pet is invalid")
  }
  return value as PetCustomPet
}

export function parsePetCustomCollectionSnapshot(value: unknown): PetCustomCollectionSnapshot {
  const object = record(value)
  if (
    !object ||
    !hasExactKeys(object, ["pets", "revision"]) ||
    !Array.isArray(object.pets) ||
    object.pets.length > 256 ||
    !safeRevision(object.revision)
  ) {
    throw new TypeError("Pet collection is invalid")
  }
  object.pets.forEach(parsePetCustomPet)
  return value as PetCustomCollectionSnapshot
}

export function parsePetHostResult<Method extends PetHostMethod>(method: Method, value: unknown): PetHostResult<Method> {
  switch (method) {
    case "activity.getSnapshot":
      return parsePetActivitySnapshot(value) as PetHostResult<Method>
    case "collection.delete":
    case "collection.get":
      return parsePetCustomCollectionSnapshot(value) as PetHostResult<Method>
    case "collection.import":
      return (value === null ? null : parsePetCustomPet(value)) as PetHostResult<Method>
    case "lifecycle.setAwake":
    case "preferences.get":
    case "preferences.update":
      return parsePetPreferences(value) as PetHostResult<Method>
    case "activity.open":
    case "overlay.move":
    case "overlay.setExpanded":
      return value as PetHostResult<Method>
  }
}

export function parsePetHostEvent(value: unknown): PetHostEvent {
  if (!isPetHostMessageWithinLimit(value)) throw new TypeError("Pet Host event exceeds the size limit")
  const object = record(value)
  if (
    !object ||
    !hasExactKeys(object, ["event", "payload", "protocol", "type"]) ||
    object.protocol !== petHostProtocol ||
    object.type !== "event"
  ) {
    throw new TypeError("Pet Host event is invalid")
  }
  switch (object.event) {
    case "activity.changed":
      parsePetActivitySnapshot(object.payload)
      break
    case "collection.changed":
      parsePetCustomCollectionSnapshot(object.payload)
      break
    case "preferences.changed":
      parsePetPreferences(object.payload)
      break
    default:
      throw new TypeError("Pet Host event is invalid")
  }
  return value as PetHostEvent
}

export function isPetHostConnect<Surface extends PetHostSurface>(
  value: unknown,
  surface: Surface,
  expectedPluginId: string,
): value is Extract<PetHostConnect, { readonly surface: Surface }> {
  const object = record(value)
  if (!object || object.protocol !== petHostProtocol || object.type !== "connect" || object.surface !== surface) {
    return false
  }
  if (!pluginId(object.pluginId) || object.pluginId !== expectedPluginId) return false
  if (surface === "overlay") return hasExactKeys(object, ["pluginId", "protocol", "surface", "type"])
  return (
    hasExactKeys(object, ["connectionId", "generation", "pluginId", "protocol", "surface", "type"]) &&
    text(object.connectionId, 80) &&
    Number.isSafeInteger(object.generation) &&
    (object.generation as number) >= 1
  )
}
