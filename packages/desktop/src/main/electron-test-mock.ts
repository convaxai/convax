import { mock } from "bun:test"

const electronNamespaceNames = [
  "app",
  "BrowserWindow",
  "contextBridge",
  "dialog",
  "ipcMain",
  "ipcRenderer",
  "net",
  "protocol",
  "shell",
  "webUtils",
] as const

type ElectronNamespaceName = (typeof electronNamespaceNames)[number]
type ElectronNamespaceMock = Record<string, unknown>

export type ElectronTestMock = Partial<Record<ElectronNamespaceName, ElectronNamespaceMock>>

let implementation: ElectronTestMock = {}

const electronModuleMock = Object.fromEntries(
  electronNamespaceNames.map((namespace) => [namespace, createDelegatingNamespace(namespace)]),
)

void mock.module("electron", () => electronModuleMock)

export function configureElectronMock(next: ElectronTestMock) {
  implementation = next
}

export function resetElectronMock() {
  implementation = {}
}

function createDelegatingNamespace(namespace: ElectronNamespaceName) {
  return new Proxy(Object.create(null) as ElectronNamespaceMock, {
    get(_target, property) {
      if (typeof property !== "string") return undefined
      const value = implementation[namespace]?.[property]
      if (typeof value === "function") {
        return (...args: unknown[]) => Reflect.apply(value, implementation[namespace], args)
      }
      if (value !== undefined) return value
      return () => {
        throw new Error(`Electron test mock is not configured for ${namespace}.${property}`)
      }
    },
  })
}
