import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react"
import type { CanvasDocument, CanvasPoint, CanvasResource } from "./types"

export interface CanvasServiceContext {
  documentId: string
  selectedNodeIds: readonly string[]
  source: string
}

export interface CanvasUploadRequest {
  files: readonly File[]
  position?: CanvasPoint
  context: CanvasServiceContext
  signal: AbortSignal
}

export interface CanvasUploadService {
  upload: (request: CanvasUploadRequest) => Promise<readonly CanvasResource[]>
}

export interface CanvasGenerationReference {
  nodeId: string
  kind: string
  text?: string
  url?: string
}

export interface CanvasGenerationItem {
  id?: string
  nodeType?: string
  title?: string
  text?: string
  resource?: CanvasResource
  metadata?: Record<string, unknown>
}

export interface CanvasGenerateRequest {
  prompt: string
  references: readonly CanvasGenerationReference[]
  context: CanvasServiceContext
  signal: AbortSignal
}

export interface CanvasGenerateService {
  generate: (request: CanvasGenerateRequest) => Promise<readonly CanvasGenerationItem[]>
}

export interface CanvasPersistenceService {
  load: (documentId: string, signal: AbortSignal) => Promise<CanvasDocument | null>
  save: (document: CanvasDocument, signal: AbortSignal) => Promise<void>
}

export interface CanvasExportRequest {
  document: CanvasDocument
  format: string
  selectedNodeIds: readonly string[]
}

export interface CanvasExportService {
  export: (request: CanvasExportRequest, signal: AbortSignal) => Promise<Blob | void>
}

export interface CanvasNotification {
  kind: "success" | "info" | "warning" | "error"
  title: string
  description?: string
}

export interface CanvasNotificationService {
  show: (notification: CanvasNotification) => void
}

export interface CanvasTelemetryEvent {
  name: string
  properties?: Record<string, unknown>
}

export interface CanvasTelemetryService {
  track: (event: CanvasTelemetryEvent) => void
}

export interface CanvasServiceMap {
  upload: CanvasUploadService
  generate: CanvasGenerateService
  persistence: CanvasPersistenceService
  export: CanvasExportService
  notify: CanvasNotificationService
  telemetry: CanvasTelemetryService
}

export interface CanvasServices {
  get: <K extends keyof CanvasServiceMap>(key: K) => CanvasServiceMap[K] | undefined
  has: (key: keyof CanvasServiceMap) => boolean
  register: <K extends keyof CanvasServiceMap>(key: K, service: CanvasServiceMap[K]) => () => void
  require: <K extends keyof CanvasServiceMap>(key: K) => CanvasServiceMap[K]
  subscribe: (listener: () => void) => () => void
  getVersion: () => number
}

export function createCanvasServices(initial?: Partial<CanvasServiceMap>): CanvasServices {
  const entries = new Map<keyof CanvasServiceMap, unknown>(
    Object.entries(initial ?? {}) as [keyof CanvasServiceMap, unknown][],
  )
  const listeners = new Set<() => void>()
  let version = 0
  const emit = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }

  return {
    get(key) {
      return entries.get(key) as CanvasServiceMap[typeof key] | undefined
    },
    has(key) {
      return entries.has(key)
    },
    register(key, service) {
      const previous = entries.get(key)
      entries.set(key, service)
      emit()
      return () => {
        if (entries.get(key) !== service) return
        if (previous) entries.set(key, previous)
        if (!previous) entries.delete(key)
        emit()
      }
    },
    require(key) {
      const service = entries.get(key) as CanvasServiceMap[typeof key] | undefined
      if (service) return service
      throw new Error(`Canvas service is not registered: ${String(key)}`)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getVersion() {
      return version
    },
  }
}

const CanvasServicesContext = createContext<CanvasServices | null>(null)

export function CanvasServicesProvider(props: { children: ReactNode; services: CanvasServices }) {
  return <CanvasServicesContext value={props.services}>{props.children}</CanvasServicesContext>
}

export function useCanvasServices() {
  const services = useContext(CanvasServicesContext)
  if (services) return services
  throw new Error("CanvasServicesProvider is missing")
}

export function useCanvasService<K extends keyof CanvasServiceMap>(key: K) {
  const services = useCanvasServices()
  useSyncExternalStore(services.subscribe, services.getVersion, services.getVersion)
  return services.get(key)
}

