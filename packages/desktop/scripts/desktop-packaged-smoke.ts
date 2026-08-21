import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import { get as httpGet } from "node:http"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { inspectAgentSkillDirectory } from "@convax/agent-runtime/node"
import { canonicalJson, computeSourceKey, parseMarketplaceProductLock, sha256Hex } from "@convax/marketplace"
import { pluginExecutionAuthorizationIdentity } from "../src/main/plugin-installation-runtime"
import type { InstalledPluginSnapshotDescriptor } from "../src/main/plugin-installation-snapshot-contracts"
import { PackagedMarketplaceProduct } from "../src/main/packaged-marketplace-product"
import { unpackSafeZip } from "../src/main/safe-zip"
import { exactSkillTreeDigest } from "../src/main/skill-manager"

import { desktopPackagedSmokeLaunchArguments } from "./desktop-packaged-smoke-args"
import {
  assertAutomaticPreinstalledAuthorization,
  assertLocalMarketplaceIdentity,
  assertMarketplaceSmokeSnapshot,
  assertNoLegacyDefaultCapabilityReceipt,
  packagedStartupStageReached,
} from "./desktop-packaged-smoke-marketplace"

const desktopRoot = path.resolve(import.meta.dirname, "..")
const distRoot = path.join(desktopRoot, "dist")
const startupTimeoutMs = process.platform === "win32" ? 180_000 : 90_000
const operationTimeoutMs = 120_000
const pluginTimeoutMs = 45_000
const defaultRemotePluginId = "ffmpeg-tools"

function loopbackNoProxy(value: string | undefined) {
  const entries = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  entries.add("127.0.0.1")
  entries.add("localhost")
  entries.add("::1")
  return [...entries].join(",")
}

// The smoke harness uses loopback control planes. Keep its own debugger requests
// away from a developer machine's HTTP(S)_PROXY endpoint.
const configuredNoProxy = [process.env.NO_PROXY, process.env.no_proxy].filter(Boolean).join(",")
const packagedSmokeNoProxy = loopbackNoProxy(configuredNoProxy)
process.env.NO_PROXY = packagedSmokeNoProxy
process.env.no_proxy = packagedSmokeNoProxy

interface DebugTarget {
  type: string
  url?: string
  webSocketDebuggerUrl?: string
}

interface FrameTree {
  childFrames?: FrameTree[]
  frame: {
    id: string
    url: string
  }
}

interface RuntimeContext {
  auxData?: {
    frameId?: string
    isDefault?: boolean
  }
  id: number
}

interface DevtoolsMessage {
  error?: { code?: number; message: string }
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
}

function reservePort() {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  })
}

async function listDebugTargets(port: number) {
  return new Promise<DebugTarget[]>((resolve, reject) => {
    const request = httpGet(
      {
        hostname: "127.0.0.1",
        path: "/json/list",
        port,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Debugger target list returned HTTP ${response.statusCode ?? "unknown"}`))
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as DebugTarget[])
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    request.setTimeout(1_000, () => request.destroy(new Error("Debugger target list timed out")))
    request.on("error", reject)
  })
}

async function waitForRendererTarget(port: number, child: Bun.Subprocess, startupDiagnosticsPath: string) {
  const deadline = Date.now() + startupTimeoutMs
  let lastError: unknown
  const observedTargets = new Set<string>()
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged Desktop exited before startup (code ${child.exitCode})`)
    try {
      const targets = await listDebugTargets(port)
      targets.forEach((target) => observedTargets.add(`${target.type}:${target.url ?? "<no-url>"}`))
      const target = targets.find(
        (candidate) =>
          candidate.type === "page" &&
          candidate.url?.startsWith("file://") &&
          candidate.url.includes("app.asar") &&
          candidate.url.endsWith("/out/renderer/index.html"),
      )
      if (target?.webSocketDebuggerUrl) return target
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  const startupDiagnostics = await fs
    .readFile(startupDiagnosticsPath, "utf8")
    .then((value) => value.trim())
    .catch(() => "<no startup diagnostics>")
  throw new Error(
    `Timed out waiting for the packaged app.asar renderer; observed ${JSON.stringify([...observedTargets])}${lastError ? `: ${String(lastError)}` : ""}; startup diagnostics: ${startupDiagnostics}`,
  )
}

async function waitForStartupStage(child: Bun.Subprocess, startupDiagnosticsPath: string, stage: string) {
  const deadline = Date.now() + operationTimeoutMs
  let diagnostics = ""
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Desktop exited before ${stage} (code ${child.exitCode})`)
    }
    diagnostics = await fs.readFile(startupDiagnosticsPath, "utf8").catch(() => "")
    if (packagedStartupStageReached(diagnostics, stage)) return
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for packaged startup stage ${stage}: ${diagnostics.trim() || "<no diagnostics>"}`)
}

class DevtoolsClient {
  private nextRequestId = 0
  private readonly pending = new Map<
    number,
    {
      reject(error: Error): void
      resolve(value: unknown): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly contexts = new Map<number, RuntimeContext>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)))
    socket.addEventListener("close", () => {
      this.rejectPending(new Error("Debugger WebSocket closed"))
      this.contexts.clear()
    })
    socket.addEventListener("error", () => this.rejectPending(new Error("Debugger WebSocket failed")))
  }

  static async connect(webSocketUrl: string) {
    const socket = new WebSocket(webSocketUrl)
    const client = new DevtoolsClient(socket)
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out connecting to the debugger WebSocket")), 10_000)
        socket.addEventListener(
          "open",
          () => {
            clearTimeout(timer)
            resolve()
          },
          { once: true },
        )
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer)
            reject(new Error("Debugger WebSocket failed before opening"))
          },
          { once: true },
        )
      })
      await Promise.all([client.request("Page.enable"), client.request("Runtime.enable")])
      return client
    } catch (error) {
      client.close()
      throw error
    }
  }

  close() {
    this.socket.close()
    this.rejectPending(new Error("Debugger client disposed"))
    this.contexts.clear()
  }

  contextForFrame(frameId: string) {
    return [...this.contexts.values()].find(
      (context) => context.auxData?.frameId === frameId && context.auxData.isDefault !== false,
    )?.id
  }

  async evaluate(expression: string, options: { contextId?: number; timeoutMs?: number } = {}) {
    const response = (await this.request(
      "Runtime.evaluate",
      {
        awaitPromise: true,
        ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
        expression,
        returnByValue: true,
        userGesture: true,
      },
      options.timeoutMs ?? operationTimeoutMs,
    )) as {
      exceptionDetails?: {
        exception?: { description?: string }
        text?: string
      }
      result?: {
        description?: string
        value?: unknown
      }
    }
    if (response.exceptionDetails) {
      const message =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        response.result?.description ??
        "Debugger evaluation failed"
      throw new Error(message)
    }
    return response.result?.value
  }

  async frameTree() {
    const response = (await this.request("Page.getFrameTree")) as { frameTree?: FrameTree }
    if (!response.frameTree) throw new Error("Debugger did not return a frame tree")
    return response.frameTree
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000) {
    const id = ++this.nextRequestId
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timed out waiting for ${method}`))
      }, timeoutMs)
      this.pending.set(id, { reject, resolve, timer })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private handleMessage(value: string) {
    let message: DevtoolsMessage
    try {
      message = JSON.parse(value) as DevtoolsMessage
    } catch {
      return
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) pending.reject(new Error(`${message.error.message} (${message.error.code ?? "unknown"})`))
      else pending.resolve(message.result)
      return
    }
    if (message.method === "Runtime.executionContextCreated") {
      const context = message.params?.context as RuntimeContext | undefined
      if (context && typeof context.id === "number") this.contexts.set(context.id, context)
      return
    }
    if (message.method === "Runtime.executionContextDestroyed") {
      const id = message.params?.executionContextId
      if (typeof id === "number") this.contexts.delete(id)
      return
    }
    if (message.method === "Runtime.executionContextsCleared") this.contexts.clear()
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

async function walkDirectories(root: string, depth: number): Promise<string[]> {
  if (depth < 0) return []
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name))
  if (depth === 0) return directories
  return [
    ...directories,
    ...(await Promise.all(directories.map((directory) => walkDirectories(directory, depth - 1)))).flat(),
  ]
}

async function regularFile(filePath: string) {
  return fs.stat(filePath).then(
    (stat) => stat.isFile(),
    () => false,
  )
}

async function sha256(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function packagedExecutableCandidates() {
  const directories = await walkDirectories(distRoot, 3)
  if (process.platform === "darwin") {
    const applications = directories.filter((directory) => directory.endsWith(".app"))
    return (
      await Promise.all(
        applications.map(async (application) => {
          const executableDirectory = path.join(application, "Contents", "MacOS")
          const entries = await fs.readdir(executableDirectory, { withFileTypes: true }).catch(() => [])
          return entries.filter((entry) => entry.isFile()).map((entry) => path.join(executableDirectory, entry.name))
        }),
      )
    ).flat()
  }
  const unpacked = directories.filter((directory) => directory.endsWith("-unpacked"))
  const names =
    process.platform === "win32"
      ? ["Convax Dev.exe", "Convax Beta.exe", "Convax.exe"]
      : ["com.microvoid.convax.dev", "com.microvoid.convax.beta", "com.microvoid.convax"]
  return (
    await Promise.all(
      unpacked
        .flatMap((directory) => names.map((name) => path.join(directory, name)))
        .map(async (candidate) => ((await regularFile(candidate)) ? [candidate] : [])),
    )
  ).flat()
}

async function resolvePackagedExecutable() {
  const requested = process.env.CONVAX_PACKAGED_EXECUTABLE
  if (requested) {
    const resolved = path.resolve(requested)
    if (!(await regularFile(resolved))) throw new Error(`Packaged executable was not found: ${resolved}`)
    return resolved
  }
  const candidates = await packagedExecutableCandidates()
  if (candidates.length === 0) {
    throw new Error(`No electron-builder --dir executable was found below ${distRoot}`)
  }
  const architectureMatches = candidates.filter((candidate) =>
    candidate.split(path.sep).some((segment) => segment.includes(process.arch)),
  )
  const preferred = architectureMatches.length > 0 ? architectureMatches : candidates
  if (preferred.length !== 1) {
    throw new Error(
      `Multiple packaged executables were found; set CONVAX_PACKAGED_EXECUTABLE explicitly: ${preferred.join(", ")}`,
    )
  }
  return preferred[0]!
}

async function verifyPackagedLayout(executable: string) {
  if (executable.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`)) {
    throw new Error(`Packaged smoke must not launch the Electron SDK: ${executable}`)
  }
  const resourcesDirectory =
    process.platform === "darwin"
      ? path.resolve(path.dirname(executable), "..", "Resources")
      : path.join(path.dirname(executable), "resources")
  const appArchive = path.join(resourcesDirectory, "app.asar")
  if (!(await regularFile(appArchive))) throw new Error(`Packaged app.asar was not found: ${appArchive}`)

  const runtimeRoot = path.join(resourcesDirectory, "opencode")
  const runtimeMetadataPath = path.join(runtimeRoot, "runtime.json")
  const runtime = JSON.parse(await fs.readFile(runtimeMetadataPath, "utf8")) as {
    arch?: string
    executable?: string
    package?: string
    platform?: string
    schema?: string
    sha256?: string
    version?: string
  }
  const packagePlatform = process.platform === "win32" ? "windows" : process.platform
  const expectedPackagePrefix = `opencode-${packagePlatform}-${process.arch}`
  if (
    runtime.schema !== "convax.packaged-runtime/1" ||
    runtime.platform !== process.platform ||
    runtime.arch !== process.arch ||
    (runtime.package !== expectedPackagePrefix && !runtime.package?.startsWith(`${expectedPackagePrefix}-`)) ||
    !/^[0-9a-f]{64}$/.test(runtime.sha256 ?? "") ||
    typeof runtime.version !== "string" ||
    !runtime.version ||
    typeof runtime.executable !== "string" ||
    !runtime.executable
  ) {
    throw new Error(`Packaged OpenCode metadata is invalid: ${JSON.stringify(runtime)}`)
  }
  const runtimeExecutable = path.resolve(runtimeRoot, ...runtime.executable.split("/"))
  if (
    !runtimeExecutable.startsWith(`${path.resolve(runtimeRoot)}${path.sep}`) ||
    !(await regularFile(runtimeExecutable))
  ) {
    throw new Error(`Packaged OpenCode executable was not found: ${runtimeExecutable}`)
  }
  const executableDigest = await sha256(runtimeExecutable)
  if (executableDigest !== runtime.sha256) {
    throw new Error(`Packaged OpenCode executable digest does not match runtime.json: ${executableDigest}`)
  }
  return { ...runtime, resourcesDirectory }
}

async function terminate(child: Bun.Subprocess) {
  if (child.exitCode !== null) return child.exited
  try {
    child.kill("SIGTERM")
  } catch {
    // Fall through to the bounded exit wait and hard termination.
  }
  await Promise.race([child.exited, Bun.sleep(5_000)])
  if (child.exitCode === null) {
    try {
      child.kill("SIGKILL")
    } catch {
      // The process may have exited between the state check and the signal.
    }
  }
  return child.exited
}

async function seedProject(userDataRoot: string, projectRoot: string) {
  const require = createRequire(path.join(desktopRoot, "package.json"))
  const entry = require.resolve("@convax/project/node")
  const projectNode = (await import(pathToFileURL(entry).href)) as typeof import("@convax/project/node")
  const projects = new projectNode.NodeProjectManager({ registryFile: path.join(userDataRoot, "projects.json") })
  return projects.addProject(projectRoot)
}

const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-packaged-smoke-用户数据 😀-"))
const projectParent = await fs.mkdtemp(path.join(os.tmpdir(), "convax packaged 项目路径 😀-"))
const projectRoot = path.join(projectParent, "packaged-smoke-project")
let child: Bun.Subprocess | undefined
let renderer: DevtoolsClient | undefined

try {
  await fs.mkdir(projectRoot)
  const seededProject = await seedProject(userDataRoot, projectRoot)
  const executable = await resolvePackagedExecutable()
  const packagedRuntime = await verifyPackagedLayout(executable)
  const productLock = parseMarketplaceProductLock(
    JSON.parse(await fs.readFile(path.resolve(desktopRoot, "..", "..", "marketplaces.lock.json"), "utf8")),
  )
  const packagedProduct = await PackagedMarketplaceProduct.load(
    path.join(packagedRuntime.resourcesDirectory, "marketplace-product"),
  )
  if (canonicalJson(packagedProduct.lock) !== canonicalJson(productLock)) {
    throw new Error("Packaged Marketplace product does not contain the repository Product Lock")
  }
  const runtimeTarget = `${process.platform}-${process.arch}`
  const officialSourceKey = computeSourceKey({
    deliveryPolicy: "github-pages-releases",
    descriptorUrl: productLock.policy.official.descriptorUrl,
    kind: "network",
    marketplaceId: productLock.policy.official.marketplaceId,
    repository: { name: "convax-plugins", owner: "convaxai" },
  })
  const expectedOfficialDefaults = productLock.resolved.packages.flatMap((entry) => {
    if (
      !entry.purposes.some((purpose) => purpose === "default-install") ||
      (entry.targets.length > 0 && !entry.targets.some((target) => target === runtimeTarget))
    ) {
      return []
    }
    const companion =
      entry.kind === "plugin"
        ? (entry.companions.find(({ platform, arch }) => `${platform}-${arch}` === runtimeTarget) ?? null)
        : null
    return [
      {
        artifact: { sha256: entry.artifact.sha256, size: entry.artifact.size },
        artifactDigest: sha256Hex(
          canonicalJson({
            kind: "artifact",
            sha256: entry.artifact.sha256,
            size: entry.artifact.size,
            url: entry.artifact.url,
          }),
        ),
        companion,
        id: entry.id,
        kind: entry.kind,
        sourceKey: officialSourceKey,
        version: entry.version,
      },
    ]
  })
  const expectedOfficialDefaultPlugins = expectedOfficialDefaults.filter((entry) => entry.kind === "plugin")
  const expectedOfficialDefaultSkills = expectedOfficialDefaults.filter((entry) => entry.kind === "skill")
  const defaultInstallExpected = expectedOfficialDefaults.some(
    (entry) => entry.id === defaultRemotePluginId && entry.kind === "plugin" && entry.version.length > 0,
  )
  const portReservation = reservePort()
  const debuggerPort = portReservation.port
  portReservation.stop(true)
  console.log(`Packaged Desktop smoke target: ${executable}`)
  console.log(
    "Smoke automation is enabling a temporary loopback DevTools Protocol endpoint; the artifact itself does not enable it.",
  )
  const environment: Record<string, string | undefined> = {
    ...process.env,
    CONVAX_PACKAGED_SMOKE: "1",
    CONVAX_PACKAGED_SMOKE_USER_DATA_DIR: userDataRoot,
  }
  delete environment.CONVAX_USER_DATA_DIR
  delete environment.ELECTRON_RENDERER_URL
  // The packaged smoke owns no deployment trust roots. Keep it offline and
  // assert the current fail-closed collaboration surface deterministically.
  delete environment.CONVAX_COLLABORATION_CONTROL_RUNTIME
  // Finder does not reliably provide shell locale variables. Exercise the final
  // macOS artifact under that GUI-style environment instead of inheriting the
  // terminal locale that launched this smoke harness.
  if (process.platform === "darwin") {
    for (const name of Object.keys(environment)) {
      if (name === "LANG" || name === "LANGUAGE" || name.startsWith("LC_")) delete environment[name]
    }
  }
  // This smoke verifies the self-contained packaged runtime and provider catalog,
  // not a developer's external network. A stale local proxy can otherwise make
  // OpenCode provider discovery hang even though the packaged binary is healthy.
  for (const name of ["ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "all_proxy", "https_proxy", "http_proxy"]) {
    delete environment[name]
  }
  const spawned = Bun.spawn(
    desktopPackagedSmokeLaunchArguments({
      debuggerPort,
      executable,
      platform: process.platform,
    }),
    {
      cwd: path.dirname(executable),
      env: environment,
      stderr: "inherit",
      stdout: "inherit",
    },
  )
  child = spawned

  const target = await waitForRendererTarget(debuggerPort, child, path.join(userDataRoot, "packaged-smoke-startup.log"))
  renderer = await DevtoolsClient.connect(target.webSocketDebuggerUrl!)
  await waitForStartupStage(child, path.join(userDataRoot, "packaged-smoke-startup.log"), "marketplace-provisioned")
  const seeded = (await renderer.evaluate(
    `(async () => {
      const timeoutMs = ${pluginTimeoutMs}
      const waitFor = async (read, label) => {
        const deadline = Date.now() + timeoutMs
        while (Date.now() < deadline) {
          const value = await read()
          if (value) return value
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw new Error("Timed out waiting for " + label)
      }
      await waitFor(() => window.convax, "the packaged preload bridge")
      const mainProtocol = await window.convax.protocol.getVersion()
      if (mainProtocol !== window.convax.protocol.version) {
        throw new Error("Packaged main/preload protocol mismatch: " + mainProtocol + " / " + window.convax.protocol.version)
      }
      const projects = await window.convax.projects.listProjects()
      const project = projects.projects.find((candidate) => candidate.name === "packaged-smoke-project")
      if (!project || project.id !== ${JSON.stringify(seededProject.id)}) {
        throw new Error(
          "Packaged Desktop did not open the isolated smoke userData; expected project "
          + ${JSON.stringify(seededProject.id)} + ", got " + JSON.stringify(projects.projects),
        )
      }
      await waitFor(async () => {
        const catalog = await window.convax.projects.canvases.getCanvasCatalog({ projectId: project.id })
        return catalog.creationAvailability === "available" && catalog.canvases.length === 1 ? catalog : undefined
      }, "the packaged Project's current local authority and initial Canvas")
      await waitFor(
        () => document.querySelector(".convax-canvas"),
        "the packaged Canvas",
      )
      if (document.querySelector('[data-project-home="true"]')) {
        throw new Error("The packaged Desktop showed first-run onboarding despite having a seeded Project")
      }
      const inventory = await window.convax.plugins.listPlugins()
      const defaultRemotePluginId = ${JSON.stringify(defaultRemotePluginId)}
      const defaultInstallExpected = ${JSON.stringify(defaultInstallExpected)}
      const packagedDefault = inventory.installed.find((plugin) => plugin.id === defaultRemotePluginId)
      if (defaultInstallExpected && !packagedDefault) {
        throw new Error("Packaged default Plugin did not install from the offline seed: " + defaultRemotePluginId)
      }
      if (!defaultInstallExpected && packagedDefault) {
        throw new Error("Packaged default Plugin installed outside its declared target: " + defaultRemotePluginId)
      }
      const settingsSources = await window.convax.marketplaces.listMarketplaces()
      const marketplaceCatalog = await window.convax.marketplaces.listCatalog()
      const catalogCard = marketplaceCatalog.cards.find(
        (card) => card.kind === "skill" && card.id === "canvas-storyboard",
      )
      const storyboardChoices = await window.convax.marketplaces.beginInstall({
        id: "canvas-storyboard",
        kind: "skill",
      })
      const storyboardChoice = storyboardChoices.find(
        (choice) => choice.marketplaceLabel === "convax-builtin",
      )
      if (!storyboardChoice) {
        throw new Error(
          "Packaged canvas-storyboard did not expose its Builtin source: " + JSON.stringify(storyboardChoices),
        )
      }
      const marketplaceInventory = await window.convax.marketplaces.listInstalled()
      const expectedOfficialDefaults = ${JSON.stringify(expectedOfficialDefaults)}
      const missingOfficialDefaults = expectedOfficialDefaults.filter(
        (expected) => !marketplaceInventory.capabilities.some(
          (capability) =>
            capability.kind === expected.kind &&
            capability.id === expected.id &&
            capability.sourceLabel === "convax-official" &&
            capability.state === "ready" &&
            capability.version === expected.version,
        ),
      )
      if (missingOfficialDefaults.length > 0) {
        throw new Error(
          "Packaged Official defaults are not ready from their exact source: " +
          JSON.stringify(missingOfficialDefaults),
        )
      }
      const storyboardInstalled = marketplaceInventory.capabilities.find(
        (capability) => capability.kind === "skill" && capability.id === "canvas-storyboard",
      )
      const ffmpegInstalled = marketplaceInventory.capabilities.find(
        (capability) => capability.kind === "plugin" && capability.id === defaultRemotePluginId,
      )
      let marketplaceSurfaceVisible = false
      const applicationMenuTrigger = document.querySelector('[data-application-menu-trigger="true"]')
      if (!(applicationMenuTrigger instanceof HTMLElement)) {
        throw new Error("The packaged sidebar did not expose the application menu")
      }
      applicationMenuTrigger.click()
      const capabilitiesMenuItem = await waitFor(
        () => document.querySelector('[data-application-menu-item="capabilities"]'),
        "the application menu Marketplace entry",
      )
      if (!(capabilitiesMenuItem instanceof HTMLElement)) {
        throw new Error("The packaged application menu did not expose Marketplace")
      }
      capabilitiesMenuItem.click()
      await waitFor(
        () => document.querySelector('[data-marketplace-surface="true"]'),
        "the packaged Marketplace Settings surface",
      )
      marketplaceSurfaceVisible = true
      return {
        defaultRemote: packagedDefault ? { id: packagedDefault.id, version: packagedDefault.version } : undefined,
        marketplace: {
          catalogCard,
          ffmpegInstalled,
          marketplaceSurfaceVisible,
          settingsSources,
          storyboardSources: storyboardChoices.map((choice) => choice.marketplaceLabel),
          storyboardChoice: {
            marketplaceLabel: storyboardChoice.marketplaceLabel,
            setup: storyboardChoice.setup,
            version: storyboardChoice.version,
          },
          storyboardInstalled,
        },
        projectId: project.id,
        protocol: mainProtocol,
      }
    })()`,
  )) as {
    defaultRemote?: { id?: string; version?: string }
    marketplace?: unknown
    projectId?: string
    protocol?: string
  }
  if (
    defaultInstallExpected !== Boolean(seeded.defaultRemote) ||
    (seeded.defaultRemote !== undefined &&
      (seeded.defaultRemote.id !== defaultRemotePluginId || !seeded.defaultRemote.version)) ||
    seeded.projectId !== seededProject.id ||
    typeof seeded.protocol !== "string"
  ) {
    throw new Error(`Unexpected packaged seed result: ${JSON.stringify(seeded)}`)
  }
  assertMarketplaceSmokeSnapshot(
    seeded.marketplace,
    defaultInstallExpected && seeded.defaultRemote?.version
      ? { id: defaultRemotePluginId, version: seeded.defaultRemote.version }
      : undefined,
    { marketplaceSurfaceRequired: true },
  )
  const agent = (await renderer.evaluate(
    `(async () => {
      const projects = await window.convax.projects.listProjects()
      const project = projects.projects.find((candidate) => candidate.id === ${JSON.stringify(seededProject.id)})
      if (!project) throw new Error("The isolated Project disappeared before the Agent check")
      const catalog = await window.convax.agent.listModels({ scopeId: project.id })
      const status = await window.convax.agent.getStatus()
      return {
        connectedProviders: catalog.providers.filter((provider) => provider.connected).length,
        modelCount: catalog.providers.reduce((count, provider) => count + provider.models.length, 0),
        providerCount: catalog.providers.length,
        state: status.state,
      }
    })()`,
    { timeoutMs: operationTimeoutMs },
  )) as {
    connectedProviders?: number
    modelCount?: number
    providerCount?: number
    state?: string
  }
  if (agent.state !== "ready" || !agent.providerCount || !agent.modelCount) {
    throw new Error(`Packaged OpenCode runtime did not become ready: ${JSON.stringify(agent)}`)
  }

  await assertLocalMarketplaceIdentity(userDataRoot)
  if (expectedOfficialDefaultPlugins.length > 0) {
    const pluginInstallationRoot = path.join(userDataRoot, "plugin-installations")
    const activePointer = JSON.parse(
      await fs.readFile(path.join(pluginInstallationRoot, "state", "active-pointer.json"), "utf8"),
    ) as { activeSetDigest?: string; schema?: string }
    if (
      activePointer.schema !== "convax.active-plugin-pointer/1" ||
      !activePointer.activeSetDigest?.match(/^[a-f0-9]{64}$/)
    ) {
      throw new Error(`Packaged Plugin ActiveSet pointer is invalid: ${JSON.stringify(activePointer)}`)
    }
    const activeSet = JSON.parse(
      await fs.readFile(
        path.join(pluginInstallationRoot, "state", "active-sets", `${activePointer.activeSetDigest}.json`),
        "utf8",
      ),
    ) as { plugins?: Array<{ pluginId?: string; snapshotDigest?: string }>; schema?: string }
    if (activeSet.schema !== "convax.active-plugin-set-snapshot/2") {
      throw new Error(`Packaged Plugin ActiveSet is invalid: ${JSON.stringify(activeSet)}`)
    }
    for (const expected of expectedOfficialDefaultPlugins) {
      const reference = activeSet.plugins?.find((plugin) => plugin.pluginId === expected.id)
      if (!reference?.snapshotDigest) {
        throw new Error(`Packaged Plugin ActiveSet does not contain ${expected.id}`)
      }
      const snapshot = JSON.parse(
        await fs.readFile(
          path.join(pluginInstallationRoot, "state", "installed", `${reference.snapshotDigest}.json`),
          "utf8",
        ),
      ) as InstalledPluginSnapshotDescriptor
      if (
        snapshot.schema !== "convax.installed-plugin-snapshot/1" ||
        snapshot.pluginId !== expected.id ||
        snapshot.version !== expected.version ||
        snapshot.sourceIdentity !== expected.sourceKey ||
        snapshot.package.artifact.sha256 !== expected.artifact.sha256 ||
        snapshot.package.artifact.size !== expected.artifact.size ||
        snapshot.hook !== undefined
      ) {
        throw new Error(`Packaged default Plugin snapshot is invalid: ${JSON.stringify(expected)}`)
      }
      const authorizationContractDigest = pluginExecutionAuthorizationIdentity(snapshot)
      if (!authorizationContractDigest) {
        throw new Error(`Packaged default Plugin immutable authorization is missing: ${expected.id}`)
      }
      await assertAutomaticPreinstalledAuthorization(userDataRoot, {
        artifactDigest: expected.artifactDigest,
        authorizationContractDigest,
        id: expected.id,
        sourceKey: expected.sourceKey,
        version: expected.version,
      })
      const closureRoot = path.join(pluginInstallationRoot, "closures", reference.snapshotDigest)
      if (expected.companion === null) {
        if (snapshot.companion !== undefined) {
          throw new Error(`Packaged default Plugin has an undeclared companion: ${expected.id}`)
        }
      } else {
        const companion = snapshot.companion
        const target = `${expected.companion.platform}-${expected.companion.arch}`
        if (
          !companion ||
          companion.target !== target ||
          companion.sha256 !== expected.companion.sha256 ||
          companion.size !== expected.companion.size
        ) {
          throw new Error(`Packaged default Plugin companion identity is invalid: ${expected.id}`)
        }
        const companionRoot = path.join(closureRoot, "companion")
        const executable = path.resolve(companionRoot, ...companion.entryPath.split("/"))
        if (
          !executable.startsWith(`${path.resolve(companionRoot)}${path.sep}`) ||
          !(await regularFile(executable)) ||
          (await sha256(executable)) !== companion.sha256 ||
          (await fs.stat(executable)).size !== companion.size
        ) {
          throw new Error(`Packaged default Plugin companion file is invalid: ${expected.id}`)
        }
      }
    }
    if (defaultInstallExpected) {
      const defaultRemote = seeded.defaultRemote
      if (!defaultRemote?.version) throw new Error("Packaged default Plugin identity is missing")
      const ffmpegReference = activeSet.plugins?.find((plugin) => plugin.pluginId === defaultRemotePluginId)
      if (!ffmpegReference?.snapshotDigest) {
        throw new Error(`Packaged Plugin ActiveSet does not contain ${defaultRemotePluginId}`)
      }
      const ffmpegSnapshot = JSON.parse(
        await fs.readFile(
          path.join(pluginInstallationRoot, "state", "installed", `${ffmpegReference.snapshotDigest}.json`),
          "utf8",
        ),
      ) as InstalledPluginSnapshotDescriptor
      const ffmpegClosureRoot = path.join(pluginInstallationRoot, "closures", ffmpegReference.snapshotDigest)
      const ffmpegManifest = JSON.parse(
        await fs.readFile(path.join(ffmpegClosureRoot, "package", "manifest.json"), "utf8"),
      ) as { id?: string; runtime?: { command?: string }; version?: string }
      if (
        ffmpegSnapshot.schema !== "convax.installed-plugin-snapshot/1" ||
        ffmpegSnapshot.pluginId !== defaultRemotePluginId ||
        ffmpegSnapshot.version !== defaultRemote.version ||
        ffmpegManifest.id !== defaultRemotePluginId ||
        ffmpegManifest.version !== defaultRemote.version ||
        ffmpegManifest.runtime?.command !== "convax-ffmpeg-mcp" ||
        ffmpegSnapshot.companion?.entryPath !== ffmpegManifest.runtime.command
      ) {
        throw new Error(`Packaged default Plugin installation is invalid: ${JSON.stringify(ffmpegManifest)}`)
      }
    }
  }
  for (const expected of expectedOfficialDefaultSkills) {
    const registryItem = packagedProduct.registry.packages.find(
      (entry) =>
        entry.kind === "skill" &&
        entry.id === expected.id &&
        entry.version === expected.version &&
        entry.ownerPluginId === undefined &&
        entry.delivery.kind === "artifact",
    )
    if (!registryItem) throw new Error(`Packaged default standalone Skill metadata is missing: ${expected.id}`)
    const candidate = await packagedProduct.verifiedCandidate(registryItem)
    const expectedFiles = Object.entries(unpackSafeZip(candidate.artifactBytes)).map(([filePath, content]) => ({
      content,
      path: filePath,
    }))
    const installed = await inspectAgentSkillDirectory(
      path.join(userDataRoot, "opencode", "skills", "user", expected.id),
    )
    if (exactSkillTreeDigest(installed.files) !== exactSkillTreeDigest(expectedFiles)) {
      throw new Error(`Packaged default standalone Skill tree is not exact: ${expected.id}`)
    }
  }
  await assertNoLegacyDefaultCapabilityReceipt(userDataRoot)

  console.log(
    `Packaged Desktop smoke passed (${path.basename(executable)}, OpenCode ${packagedRuntime.version}, ${seeded.projectId}, ${defaultInstallExpected ? defaultRemotePluginId : "no target-specific default"}, ${agent.providerCount} OpenCode providers)`,
  )
  const application =
    process.platform === "darwin" ? path.resolve(path.dirname(executable), "..", "..") : path.dirname(executable)
  console.log(`Unpacked packaged application retained at: ${application}`)
  console.log(`Packaged executable retained at: ${executable}`)
} finally {
  if (renderer && child?.exitCode === null) {
    await renderer
      .evaluate(`(() => { setTimeout(() => window.close(), 0); return true })()`, { timeoutMs: 2_000 })
      .catch(() => undefined)
    await Promise.race([child.exited, Bun.sleep(5_000)])
  }
  renderer?.close()
  if (child) await terminate(child)
  await Promise.all([
    fs.rm(userDataRoot, { force: true, recursive: true }),
    fs.rm(projectParent, { force: true, recursive: true }),
  ])
}
