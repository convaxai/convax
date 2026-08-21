import { expect, test } from "bun:test"
import fs from "node:fs"

const source = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8")

test("Main creates the inert startup window before runtime restoration", () => {
  const applicationStart = source.indexOf("function startApplication()")
  const shellCreation = source.indexOf("const startupWindow = createWindowShell()", applicationStart)
  const protocolLoad = source.indexOf("await loadCurrentCollaborationProtocol", applicationStart)
  const pluginRuntimeOpen = source.indexOf("await openDesktopPluginRuntimeSession", applicationStart)
  const petRestore = source.indexOf("await pets.initialize()", applicationStart)
  const runtimeBinding = source.indexOf("bindWindowRuntime(startupWindow", applicationStart)

  expect(applicationStart).toBeGreaterThan(-1)
  expect(shellCreation).toBeGreaterThan(applicationStart)
  expect(protocolLoad).toBeGreaterThan(shellCreation)
  expect(pluginRuntimeOpen).toBeGreaterThan(protocolLoad)
  expect(petRestore).toBeGreaterThan(pluginRuntimeOpen)
  expect(runtimeBinding).toBeGreaterThan(petRestore)
})

test("the startup document is replaced only by the trusted Renderer URL", () => {
  const shellStart = source.indexOf("function createWindowShell(")
  const bindingStart = source.indexOf("function bindWindowRuntime(")
  const laterWindowFactory = source.indexOf("function createWindow(", bindingStart + 1)
  const shell = source.slice(shellStart, bindingStart)
  const binding = source.slice(bindingStart, laterWindowFactory)

  expect(shell).toContain("window.loadURL(desktopStartupPageUrl(applicationName))")
  expect(shell).not.toContain("trustedWebContents.add")
  expect(binding).toContain("trustedWebContents.add(webContentsId)")
  expect(binding).toContain("window.loadURL(trustedRendererUrl)")
})
