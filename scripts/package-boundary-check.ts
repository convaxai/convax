import { builtinModules } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"

import { verifyCurrentProtocolDescriptorFile } from "./collaboration-protocol/generate"

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown> | string
  files?: string[]
  name?: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  private?: boolean
  scripts?: Record<string, string>
  version?: string
}

type WorkspacePackage = {
  directory: string
  manifest: PackageManifest
  name: string
}

const repositoryRoot = join(import.meta.dir, "..")
const hostChangeGovernancePath = join(repositoryRoot, "docs", "plugin-host-change-governance.md")
const architectureContractPath = join(repositoryRoot, "docs", "architecture.md")
const nexusServiceIntegrationPath = join(repositoryRoot, "docs", "nexus-service-integration.md")
const desktopCompositionPath = join(repositoryRoot, "packages", "desktop", "src", "main", "index.ts")
const archivedAuthorityTokens = [
  ["docs/superpowers/specs/", "authorities"].join(""),
  ["collaboration-v", "10-active-authority"].join(""),
  ["collaboration-v", "11-active-authority"].join(""),
]
const runtimeAndPackagingGlobs = [
  "packages/*/src/**/*.ts",
  "packages/*/scripts/**/*.ts",
  "packages/*/electron-builder.config.ts",
  "apps/*/src/**/*.ts",
]
const desktopProcessInstructionPaths = ["src/main/AGENTS.md", "src/preload/AGENTS.md", "src/renderer/AGENTS.md"]
const apiDirectory = join(repositoryRoot, "apps", "api")
const apiManifestPath = join(apiDirectory, "package.json")
const retiredRegistryPaths = [
  "packages/desktop/src/main/remote-capability-registry.ts",
  "packages/desktop/src/main/remote-capability-installer.ts",
  "packages/desktop/src/main/default-remote-capability-catalog.ts",
  "packages/desktop/src/main/electron-remote-capability-fetch.ts",
  "packages/desktop/src/main/file-remote-registry-cache.ts",
  "packages/desktop/src/main/file-remote-showcase-media-cache.ts",
  "packages/desktop/src/main/packaged-default-capabilities.ts",
  "packages/desktop/scripts/stage-default-capabilities.ts",
]
const retiredRegistryTokens = [
  "convax.registry/1",
  "convax.showcase/1",
  "RemoteCapabilityInstaller",
  "RemoteCapabilityRegistry",
  "default-remote-capability",
  "remote-capability-installer",
  "remote-capability-registry",
  "registry/v1/index.json",
]
const applicationPackageNames = new Set(["@convax/desktop"])
const publishablePackageNames = new Set([
  "@convax/agent-runtime",
  "@convax/bounded-value",
  "@convax/canvas",
  "@convax/collaboration",
  "@convax/marketplace",
  "@convax/marketplace-kit",
  "@convax/plugin-api",
  "@convax/plugin-sdk",
  "@convax/plugin-ui",
  "@convax/project",
  "@convax/project-files",
  "@convax/uri",
  "@convax/ui",
  "@convax/workbench",
  "create-convax-marketplace",
])
const apiAllowedInternalRuntimeDependencies = new Set(["@convax/collaboration", "@convax/project"])
const apiAllowedProjectSubpaths = new Set(["./collaboration-protocol"])
const reservedWorkspacePackageName = "@convax/workspace"
const allowedInternalRuntimeDependencies = new Map<string, ReadonlySet<string>>([
  ["@convax/agent-runtime", new Set()],
  ["@convax/bounded-value", new Set()],
  ["@convax/canvas", new Set(["@convax/bounded-value", "@convax/collaboration", "@convax/uri", "@convax/ui"])],
  ["@convax/collaboration", new Set()],
  ["@convax/marketplace", new Set()],
  ["@convax/plugin-api", new Set()],
  ["@convax/plugin-sdk", new Set(["@convax/bounded-value", "@convax/plugin-api"])],
  ["@convax/plugin-ui", new Set()],
  ["@convax/marketplace-kit", new Set(["@convax/marketplace", "@convax/plugin-api", "@convax/plugin-sdk"])],
  ["create-convax-marketplace", new Set(["@convax/marketplace-kit"])],
  [
    "@convax/desktop",
    new Set([
      "@convax/agent-runtime",
      "@convax/canvas",
      "@convax/collaboration",
      "@convax/marketplace",
      "@convax/plugin-api",
      "@convax/plugin-sdk",
      "@convax/project",
      "@convax/project-files",
      "@convax/uri",
      "@convax/ui",
      "@convax/workbench",
    ]),
  ],
  [
    "@convax/project",
    new Set(["@convax/canvas", "@convax/collaboration", "@convax/project-files", "@convax/uri", "@convax/ui"]),
  ],
  ["@convax/project-files", new Set(["@convax/uri"])],
  ["@convax/uri", new Set()],
  ["@convax/ui", new Set()],
  ["@convax/workbench", new Set()],
])
const allowedInternalSubpaths = new Map<string, ReadonlySet<string>>([
  ["@convax/canvas -> @convax/bounded-value", new Set(["."])],
  ["@convax/canvas -> @convax/collaboration", new Set(["."])],
  ["@convax/canvas -> @convax/uri", new Set(["."])],
  ["@convax/canvas -> @convax/ui", new Set([".", "./theme.css"])],
  ["@convax/project -> @convax/canvas", new Set(["./application", "./collaboration", "./core"])],
  ["@convax/project -> @convax/collaboration", new Set(["."])],
  ["@convax/project -> @convax/project-files", new Set([".", "./contracts", "./drag", "./identity", "./project-uri"])],
  ["@convax/project -> @convax/uri", new Set(["."])],
  ["@convax/project -> @convax/ui", new Set([".", "./theme.css"])],
  ["@convax/project-files -> @convax/uri", new Set(["."])],
  ["@convax/plugin-sdk -> @convax/bounded-value", new Set(["."])],
  ["@convax/desktop -> @convax/collaboration", new Set(["."])],
  ["@convax/desktop -> @convax/uri", new Set(["."])],
])
const nodeBuiltinSpecifiers = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

function normalizedSourcePath(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/")
}

function requireContractMarkers(path: string, source: string, markers: readonly string[]): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) {
    throw new Error(`${path}: single current collaboration protocol markers are missing: ${missing.join(", ")}`)
  }
}

function requireDocumentMarkers(path: string, source: string, markers: readonly string[], contract: string): void {
  const missing = markers.filter((marker) => !source.includes(marker))
  if (missing.length > 0) {
    throw new Error(`${path}: ${contract} markers are missing: ${missing.join(", ")}`)
  }
}

function isTestSource(sourcePath: string): boolean {
  const normalized = normalizedSourcePath(sourcePath)
  return normalized.startsWith("test/") || /(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/.test(normalized)
}

function canImportNodeBuiltins(packageName: string, sourcePath: string): boolean {
  if (isTestSource(sourcePath)) return true
  const normalized = normalizedSourcePath(sourcePath)
  if (packageName === "@convax/agent-runtime") return normalized.startsWith("src/node/")
  if (packageName === "@convax/project") return normalized.startsWith("src/node/")
  if (packageName === "@convax/desktop") return normalized.startsWith("src/main/")
  if (
    packageName === "@convax/marketplace" ||
    packageName === "@convax/marketplace-kit" ||
    packageName === "@convax/plugin-api" ||
    packageName === "@convax/plugin-sdk" ||
    packageName === "create-convax-marketplace"
  )
    return true
  return false
}

function canImportElectron(packageName: string, sourcePath: string): boolean {
  if (packageName !== "@convax/desktop") return false
  const normalized = normalizedSourcePath(sourcePath)
  return normalized.startsWith("src/main/") || normalized.startsWith("src/preload/")
}

function canImportNodeEntry(packageName: string, sourcePath: string): boolean {
  if (isTestSource(sourcePath)) return true
  return packageName === "@convax/desktop" && normalizedSourcePath(sourcePath).startsWith("src/main/")
}

function matchesExport(exports: PackageManifest["exports"], subpath: string): boolean {
  if (typeof exports === "string") return subpath === "."
  if (!exports) return false
  if (subpath in exports) return true
  return Object.keys(exports).some((key) => {
    const wildcard = key.indexOf("*")
    if (wildcard < 0) return false
    return subpath.startsWith(key.slice(0, wildcard)) && subpath.endsWith(key.slice(wildcard + 1))
  })
}

function leavesPackage(sourceFile: string, specifier: string, packageDirectory: string): boolean {
  const target = resolve(dirname(sourceFile), specifier)
  const pathFromPackage = relative(packageDirectory, target)
  return pathFromPackage === ".." || pathFromPackage.startsWith(`..${sep}`)
}

function findCycle(graph: Map<string, Set<string>>): string[] | undefined {
  const visited = new Set<string>()
  const active = new Set<string>()
  const path: string[] = []

  const visit = (name: string): string[] | undefined => {
    if (active.has(name)) return [...path.slice(path.indexOf(name)), name]
    if (visited.has(name)) return undefined
    visited.add(name)
    active.add(name)
    path.push(name)
    for (const dependency of graph.get(name) ?? []) {
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    path.pop()
    active.delete(name)
    return undefined
  }

  for (const name of graph.keys()) {
    const cycle = visit(name)
    if (cycle) return cycle
  }
  return undefined
}

const packages: WorkspacePackage[] = []
const rootContract = await Bun.file(join(repositoryRoot, "AGENTS.md")).text()
const architectureContract = await Bun.file(architectureContractPath).text()
const hostChangeGovernance = await Bun.file(hostChangeGovernancePath).text()
const nexusServiceIntegration = await Bun.file(nexusServiceIntegrationPath).text()
const desktopComposition = await Bun.file(desktopCompositionPath).text()
if (
  !rootContract.includes("## Plugin-to-Host change gate") ||
  !rootContract.includes("Agent-authored approval text") ||
  !rootContract.includes("protected external decision receipt") ||
  !hostChangeGovernance.includes("Status: mandatory review gate.") ||
  !hostChangeGovernance.includes("must not decide to modify the Convax repository") ||
  !hostChangeGovernance.includes("Status: pending human review") ||
  !hostChangeGovernance.includes("Decision: pending") ||
  !hostChangeGovernance.includes("Approval prose committed by an Agent or Plugin author is not an approval")
) {
  throw new Error("Plugin-to-Host human review gate is missing from the architecture contract")
}
requireDocumentMarkers(
  "docs/nexus-service-integration.md",
  nexusServiceIntegration,
  [
    "# Convax × AuthX × Nexus 本地集成执行契约",
    "AuthX 是唯一身份 Owner",
    "AuthX Convax Application Access Token",
    "不执行 Token",
    "aud === Convax client_id",
    "同一枚 AuthX Convax Application Access",
    "nexus:access",
    "AuthX Console 是唯一启用入口",
    "AuthX integration backend",
    "## 7. 自动创建 Nexus Convax Application",
    "PUT /api/v1/integrations/authx/{authx_integration_id}/applications/convax",
    'product_profile_key: "convax-default"',
    "nexus_application_id",
    "重新启用必须重新激活同一个",
    "ensureApplicationSubjectAccess",
    "没有客户端 bootstrap/connect 步骤",
    "GET  /api/v1/application-access/status",
    "POST /api/v1/application-access/checkout",
    "Authorization: Bearer <AuthX Convax Application Access Token>",
    "OS credential store",
    "DELETE /v1/videos/{providerTaskId}",
    "convax/generation/operations/get",
    "convax/generation/operations/wait",
    "convax/generation/operations/cancel",
    "convax/generation/operations/result",
    "convax/generation/operations/acknowledge",
    "CONVAX_GENERATION_LRO_DIRECTORY",
    "authx:convax:interactive-login",
    "marketplace:local-product-lock-input",
    "convax.nexus-public-profile/1",
    "external_provider_calls",
    "本方案不需要 Convax Host change",
    "**未完成**",
  ],
  "AuthX and Nexus integration",
)
const retiredNexusIntegrationAssertions = [
  "状态：MVP 核心链路已实现",
  "MVP 已实现并完成本地真实验收",
  "Nexus Hosted Auth、User API、Data Token、Convax 通用外部浏览器授权",
  "https://nexus.microvoid.io/workspace/convax/auth/sign-in",
  "deepseek/deepseek-v4-flash",
  "GET  /user/v1/me/access",
  "POST /user/v1/data-tokens",
  "Nexus Gateway 继续只接受 Nexus Inference Key",
  "-> one-time Nexus Inference Key",
  "Authorization: Bearer <Nexus Inference Key>",
  "Nexus Console 是推荐的配置主入口",
]
for (const assertion of retiredNexusIntegrationAssertions) {
  if (nexusServiceIntegration.includes(assertion)) {
    throw new Error(`docs/nexus-service-integration.md: retired Nexus integration assertion remains: ${assertion}`)
  }
}
await verifyCurrentProtocolDescriptorFile(repositoryRoot)
requireContractMarkers("AGENTS.md", rootContract, [
  "## Single current collaboration protocol",
  "current protocol descriptor whose exact `protocolDigest` is the only protocol",
  "The packaged current protocol descriptor must equal the built descriptor digest",
  "There is no authority selector, active/pinned release pair, dual-version",
  "unsupported-project-data",
  "### Frozen collaboration authority archive",
  "non-runtime archive and review material",
  "activated-authority-mutation",
  "`replicaDoc`/isolated `candidateDoc` kernel",
  "ProjectIndexYDoc is the only Project route/tombstone and current `shardEpoch`",
  "Checkpoint pruning requires both a service content certificate",
  "React Flow document projection",
])
requireContractMarkers("docs/architecture.md", architectureContract, [
  "one current protocol descriptor",
  "`protocolDigest` is the only protocol identity",
  "unsupported-project-data",
  "Main-owned `replicaDoc`",
  "Isolated `candidateDoc`",
  "Final offline/online edit object",
  "Content certificate plus all-active-editor causal floors",
  "Transient `@convax/canvas` projection",
  "service registry is advisory only",
  "@convax/api",
])
const collaborationGovernanceContracts = [
  ["AGENTS.md", rootContract],
  ["docs/architecture.md", architectureContract],
  ["packages/collaboration/AGENTS.md", await Bun.file(join(repositoryRoot, "packages/collaboration/AGENTS.md")).text()],
  ["packages/canvas/AGENTS.md", await Bun.file(join(repositoryRoot, "packages/canvas/AGENTS.md")).text()],
  ["packages/project/AGENTS.md", await Bun.file(join(repositoryRoot, "packages/project/AGENTS.md")).text()],
  ["packages/project-files/AGENTS.md", await Bun.file(join(repositoryRoot, "packages/project-files/AGENTS.md")).text()],
  ["packages/desktop/AGENTS.md", await Bun.file(join(repositoryRoot, "packages/desktop/AGENTS.md")).text()],
  ["apps/api/AGENTS.md", await Bun.file(join(repositoryRoot, "apps/api/AGENTS.md")).text()],
] as const
const retiredCollaborationTokens = [
  ["certified", "TeamDoc"].join(""),
  ["working", "Doc"].join(""),
  ["local", "ForkJournal"].join(""),
  ["local", "Fork"].join(""),
  ["Admission", "Certificate"].join(""),
  ["expected", "Version"].join(""),
  ["M", "MR"].join(""),
  ["certified", "-team/"].join(""),
  ["local", "-fork"].join(""),
  ["admission", "-outbox"].join(""),
  ["abandonment", "-outbox"].join(""),
  ["document", "-wide"].join(""),
  ["whole", "-document"].join(""),
  ["whole", " document"].join(""),
  ["central", " per-edit admission"].join(""),
  ["2026-07-31-", "collaboration-architecture-review.sha256"].join(""),
]
for (const [path, source] of collaborationGovernanceContracts) {
  const retiredToken = retiredCollaborationTokens.find((token) => source.includes(token))
  if (retiredToken) throw new Error(`${path}: retired collaboration state/order token remains: ${retiredToken}`)
}
requireContractMarkers("packages/collaboration/AGENTS.md", collaborationGovernanceContracts[2][1], [
  "One Main-owned `replicaDoc` per shard",
  "one isolated `candidateDoc` per command",
  "Offline work uses the same final frame bytes",
  "Reconnect requests and validates",
])
requireContractMarkers("packages/canvas/AGENTS.md", collaborationGovernanceContracts[3][1], [
  "Main's `replicaDoc` is the sole local durable Canvas authority",
  "React Flow selection, hover, measured size, camera, drag preview",
  "Project-owned route `shardEpoch`",
])
requireContractMarkers("packages/project/AGENTS.md", collaborationGovernanceContracts[4][1], [
  "ProjectIndexYDoc is the sole Project catalog",
  "current `shardEpoch` authority",
  "`ProjectIndexLiveScopeManifestV2`",
  "state is advisory anti-rollback/discovery metadata",
])
requireContractMarkers("packages/desktop/AGENTS.md", collaborationGovernanceContracts[6][1], [
  "Each offline/local commit is the final long-lived-replica-signed causal frame",
  "Reconnect transmits the same bytes",
  "both content certification and exact all-active-editor causal-floor",
])
requireContractMarkers("apps/api/AGENTS.md", collaborationGovernanceContracts[7][1], [
  "The service never orders ordinary edits",
  "registered-scope service registry is bounded advisory anti-rollback/discovery",
  "both a content certificate",
])
if (!(await Bun.file(apiManifestPath).exists())) throw new Error("apps/api/package.json is required")
if (
  desktopComposition.includes("RemoteCapabilityRegistryClient") ||
  desktopComposition.includes("registry/v1/index.json") ||
  desktopComposition.includes("convax.registry/1")
) {
  throw new Error("Desktop production composition must use Marketplace v2 and must not revive the legacy Registry v1")
}
for (const retiredPath of retiredRegistryPaths) {
  if (await Bun.file(join(repositoryRoot, retiredPath)).exists()) {
    throw new Error(`${retiredPath}: legacy Registry v1 ownership must not be restored`)
  }
}
for await (const sourcePath of new Bun.Glob("packages/desktop/src/main/**/*.ts").scan(repositoryRoot)) {
  if (sourcePath.endsWith(".test.ts") || sourcePath.endsWith(".fixture.ts")) continue
  const source = await Bun.file(join(repositoryRoot, sourcePath)).text()
  const retiredToken = retiredRegistryTokens.find((token) => source.includes(token))
  if (retiredToken) {
    throw new Error(`${sourcePath}: production source revives retired Registry v1 ownership (${retiredToken})`)
  }
}
for (const pattern of runtimeAndPackagingGlobs) {
  for await (const sourcePath of new Bun.Glob(pattern).scan(repositoryRoot)) {
    if (isTestSource(sourcePath) || sourcePath.includes(".test-support.")) continue
    const source = await Bun.file(join(repositoryRoot, sourcePath)).text()
    const archivedToken = archivedAuthorityTokens.find((token) => source.includes(token))
    if (archivedToken) {
      throw new Error(
        `${sourcePath}: production and packaging source must not read the archived authority release (${archivedToken}); use the current protocol descriptor`,
      )
    }
  }
}
for await (const manifestPath of new Bun.Glob("packages/*/package.json").scan(repositoryRoot)) {
  const directory = dirname(join(repositoryRoot, manifestPath))
  const manifest = (await Bun.file(join(repositoryRoot, manifestPath)).json()) as PackageManifest
  if (!manifest.name) throw new Error(`${manifestPath}: package name is required`)
  packages.push({ directory, manifest, name: manifest.name })
}

for (const workspacePackage of packages) {
  const instructionPath = normalizedSourcePath(relative(repositoryRoot, join(workspacePackage.directory, "AGENTS.md")))
  if (!(await Bun.file(join(repositoryRoot, instructionPath)).exists())) {
    throw new Error(`${workspacePackage.name}: every package needs a local AGENTS.md ownership contract`)
  }
  if (!rootContract.includes(`(${instructionPath})`)) {
    throw new Error(`${workspacePackage.name}: root AGENTS.md must route to ${instructionPath}`)
  }
}
for await (const manifestPath of new Bun.Glob("apps/*/package.json").scan(repositoryRoot)) {
  const instructionPath = normalizedSourcePath(join(dirname(manifestPath), "AGENTS.md"))
  if (!(await Bun.file(join(repositoryRoot, instructionPath)).exists())) {
    throw new Error(`${instructionPath}: application delivery surface needs a local AGENTS.md contract`)
  }
  if (!rootContract.includes(`(${instructionPath})`)) {
    throw new Error(`root AGENTS.md must route to ${instructionPath}`)
  }
}
const desktopContract = await Bun.file(join(repositoryRoot, "packages", "desktop", "AGENTS.md")).text()
for (const instructionPath of desktopProcessInstructionPaths) {
  const absoluteInstructionPath = join(repositoryRoot, "packages", "desktop", instructionPath)
  if (!(await Bun.file(absoluteInstructionPath).exists())) {
    throw new Error(`packages/desktop/${instructionPath}: Desktop process needs a local AGENTS.md contract`)
  }
  if (!desktopContract.includes(`(${instructionPath})`)) {
    throw new Error(`packages/desktop/AGENTS.md must route to ${instructionPath}`)
  }
}

const packagesByName = new Map(packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]))
const apiManifest = (await Bun.file(apiManifestPath).json()) as PackageManifest
if (apiManifest.name !== "@convax/api" || !apiManifest.private) {
  throw new Error("apps/api must be the private @convax/api delivery application")
}
if (!(await Bun.file(join(apiDirectory, "AGENTS.md")).exists())) {
  throw new Error("@convax/api needs a local AGENTS.md ownership contract")
}
for (const script of ["build", "test", "typecheck"]) {
  if (!apiManifest.scripts?.[script]) throw new Error(`@convax/api needs a package-local ${script} script`)
}
const apiRuntimeDependencies = {
  ...apiManifest.dependencies,
  ...apiManifest.optionalDependencies,
  ...apiManifest.peerDependencies,
}
for (const dependency of Object.keys(apiRuntimeDependencies)) {
  if (!apiAllowedInternalRuntimeDependencies.has(dependency)) {
    throw new Error(
      `@convax/api runtime dependency ${dependency} is forbidden; only ${[...apiAllowedInternalRuntimeDependencies].join(", ")} are admitted`,
    )
  }
}
for (const workspacePackage of packages) {
  if (!workspacePackage.name.startsWith("@convax/") && workspacePackage.name !== "create-convax-marketplace") {
    throw new Error(`${workspacePackage.name}: workspace packages must use the @convax scope except the create CLI`)
  }
  if (!allowedInternalRuntimeDependencies.has(workspacePackage.name)) {
    throw new Error(
      `${workspacePackage.name}: package ownership is not registered; update AGENTS.md, docs/architecture.md, and package-boundary-check.ts`,
    )
  }
  if (!applicationPackageNames.has(workspacePackage.name) && !publishablePackageNames.has(workspacePackage.name)) {
    throw new Error(`${workspacePackage.name}: new library packages must be registered as independently publishable`)
  }
}
for (const packageName of allowedInternalRuntimeDependencies.keys()) {
  if (!packagesByName.has(packageName)) {
    throw new Error(`${packageName}: architecture dependency policy refers to a missing workspace package`)
  }
}
for (const name of publishablePackageNames) {
  const workspacePackage = packagesByName.get(name)
  if (!workspacePackage || workspacePackage.manifest.private) {
    throw new Error(`${name}: expected an independent publishable package`)
  }
  const { exports, files, scripts, version } = workspacePackage.manifest
  if (
    !version ||
    version === "0.0.0" ||
    !files?.includes("dist") ||
    !exports ||
    typeof exports === "string" ||
    !matchesExport(exports, ".")
  ) {
    throw new Error(`${name}: publishable packages need a real version, dist files, and a public root export`)
  }
  for (const script of ["build", "clean", "prepack", "prepublishOnly", "test", "typecheck"]) {
    if (!scripts?.[script]) throw new Error(`${name}: publishable packages need a package-local ${script} script`)
  }
}
for (const name of applicationPackageNames) {
  const workspacePackage = packagesByName.get(name)
  if (!workspacePackage?.manifest.private) {
    throw new Error(`${name}: application composition packages must stay private`)
  }
}

const graph = new Map<string, Set<string>>()
graph.set("@convax/api", new Set(Object.keys(apiRuntimeDependencies)))

for (const sourceRoot of ["src", "test"]) {
  for await (const sourcePath of new Bun.Glob(`${sourceRoot}/**/*.{ts,tsx,js,jsx,mjs,cjs}`).scan(apiDirectory)) {
    const absoluteSourcePath = join(apiDirectory, sourcePath)
    const source = await Bun.file(absoluteSourcePath).text()
    const specifiers = [
      ...source.matchAll(/(?:from\s*|import\s*\(\s*|require(?:\.resolve)?\s*\(\s*)["']([^"']+)["']/g),
      ...source.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g),
    ].map((match) => match[1])
    for (const specifier of specifiers) {
      if (specifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(specifier) || specifier.startsWith("file:")) {
        throw new Error(`apps/api/${sourcePath}: absolute file imports are not portable: ${specifier}`)
      }
      if ((specifier.startsWith(".") || specifier.startsWith("@convax/")) && specifier.includes("\\")) {
        throw new Error(`apps/api/${sourcePath}: module specifiers must use forward slashes: ${specifier}`)
      }
      if (specifier.startsWith(".") && leavesPackage(absoluteSourcePath, specifier, apiDirectory)) {
        throw new Error(`apps/api/${sourcePath}: relative import escapes @convax/api: ${specifier}`)
      }
      if (specifier.startsWith("bun:")) {
        if (!isTestSource(sourcePath)) {
          throw new Error(`apps/api/${sourcePath}: Bun runtime imports are forbidden outside tests`)
        }
        continue
      }
      if (nodeBuiltinSpecifiers.has(specifier) || specifier.startsWith("node:") || specifier.startsWith("electron")) {
        throw new Error(`apps/api/${sourcePath}: API runtime must stay Web-standard: ${specifier}`)
      }
      const dependencyPackage = packages.find(
        (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
      )
      if (!dependencyPackage) {
        if (!specifier.startsWith(".") && !isTestSource(sourcePath)) {
          throw new Error(`apps/api/${sourcePath}: undeclared/non-Web runtime import is forbidden: ${specifier}`)
        }
        continue
      }
      if (!apiAllowedInternalRuntimeDependencies.has(dependencyPackage.name)) {
        throw new Error(`apps/api/${sourcePath}: @convax/api cannot import ${dependencyPackage.name}`)
      }
      if (!(dependencyPackage.name in apiRuntimeDependencies)) {
        throw new Error(`apps/api/${sourcePath}: ${dependencyPackage.name} must be a declared runtime dependency`)
      }
      const suffix = specifier.slice(dependencyPackage.name.length)
      const subpath = suffix ? `.${suffix}` : "."
      if (!matchesExport(dependencyPackage.manifest.exports, subpath)) {
        throw new Error(`apps/api/${sourcePath}: ${specifier} is not a public package export`)
      }
      if (dependencyPackage.name === "@convax/project" && !apiAllowedProjectSubpaths.has(subpath)) {
        throw new Error(`apps/api/${sourcePath}: @convax/api may import only @convax/project/collaboration-protocol`)
      }
      if (dependencyPackage.name === "@convax/collaboration" && subpath !== ".") {
        throw new Error(`apps/api/${sourcePath}: @convax/api may import only the public @convax/collaboration root`)
      }
    }
  }
}
for (const workspacePackage of packages) {
  const runtimeDependencies = {
    ...workspacePackage.manifest.dependencies,
    ...workspacePackage.manifest.optionalDependencies,
    ...workspacePackage.manifest.peerDependencies,
  }
  const allDeclaredDependencies = {
    ...runtimeDependencies,
    ...workspacePackage.manifest.devDependencies,
  }
  if (reservedWorkspacePackageName in allDeclaredDependencies) {
    throw new Error(
      `${workspacePackage.name}: ${reservedWorkspacePackageName} is reserved for a future multi-project window model`,
    )
  }
  const internalRuntimeDependencies = Object.keys(runtimeDependencies).filter((dependency) =>
    packagesByName.has(dependency),
  )
  const allowedDependencies = allowedInternalRuntimeDependencies.get(workspacePackage.name)!
  for (const dependency of internalRuntimeDependencies) {
    if (!allowedDependencies.has(dependency)) {
      throw new Error(
        `${workspacePackage.name}: architecture forbids runtime dependency on ${dependency}; compose the packages in @convax/desktop instead`,
      )
    }
  }
  graph.set(workspacePackage.name, new Set(internalRuntimeDependencies))

  const validateSpecifier = (sourcePath: string, specifier: string) => {
    const absoluteSourcePath = join(workspacePackage.directory, sourcePath)
    if (specifier.startsWith("/") || /^[A-Za-z]:[\\/]/.test(specifier) || specifier.startsWith("file:")) {
      throw new Error(`${sourcePath}: absolute file imports are not portable: ${specifier}`)
    }
    if ((specifier.startsWith(".") || specifier.startsWith("@convax/")) && specifier.includes("\\")) {
      throw new Error(`${sourcePath}: module specifiers must use forward slashes on every platform: ${specifier}`)
    }
    if (specifier.startsWith(".") && leavesPackage(absoluteSourcePath, specifier, workspacePackage.directory)) {
      throw new Error(`${sourcePath}: relative import escapes ${workspacePackage.name}: ${specifier}`)
    }
    if (specifier === reservedWorkspacePackageName || specifier.startsWith(`${reservedWorkspacePackageName}/`)) {
      throw new Error(
        `${sourcePath}: ${reservedWorkspacePackageName} is reserved; Workbench owns active window state and Project owns one folder`,
      )
    }
    if (
      workspacePackage.name !== "@convax/agent-runtime" &&
      (specifier === "opencode-ai" || specifier.startsWith("opencode-ai/") || specifier.startsWith("@opencode-ai/"))
    ) {
      throw new Error(`${sourcePath}: OpenCode imports must stay behind @convax/agent-runtime`)
    }
    if (nodeBuiltinSpecifiers.has(specifier) && !canImportNodeBuiltins(workspacePackage.name, sourcePath)) {
      throw new Error(`${sourcePath}: Node built-in ${specifier} is outside an approved Node adapter directory`)
    }
    if (
      (specifier === "electron" || specifier.startsWith("electron/")) &&
      !canImportElectron(workspacePackage.name, sourcePath)
    ) {
      throw new Error(`${sourcePath}: Electron imports are limited to @convax/desktop main and preload`)
    }

    const dependencyPackage = packages.find(
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    )
    if (!dependencyPackage) return
    if (dependencyPackage.name !== workspacePackage.name && !(dependencyPackage.name in runtimeDependencies)) {
      throw new Error(
        `${sourcePath}: ${dependencyPackage.name} must be a runtime dependency of ${workspacePackage.name}`,
      )
    }

    const suffix = specifier.slice(dependencyPackage.name.length)
    const subpath = suffix ? `.${suffix}` : "."
    if (!matchesExport(dependencyPackage.manifest.exports, subpath)) {
      throw new Error(`${sourcePath}: ${specifier} is not a public export of ${dependencyPackage.name}`)
    }
    if (
      (subpath === "./node" || subpath.startsWith("./node/")) &&
      !canImportNodeEntry(workspacePackage.name, sourcePath)
    ) {
      throw new Error(`${sourcePath}: ${specifier} is a Node-only entry and may only be composed by Desktop main`)
    }
    if (dependencyPackage.name !== workspacePackage.name) {
      const edge = `${workspacePackage.name} -> ${dependencyPackage.name}`
      const allowedSubpaths = allowedInternalSubpaths.get(edge)
      if (allowedSubpaths && !allowedSubpaths.has(subpath)) {
        throw new Error(
          `${sourcePath}: architecture forbids ${specifier}; allowed ${dependencyPackage.name} entries are ${[...allowedSubpaths].join(", ")}`,
        )
      }
    }
  }

  for (const sourceRoot of ["src", "test"]) {
    for await (const sourcePath of new Bun.Glob(`${sourceRoot}/**/*.{ts,tsx,js,jsx,mjs,cjs}`).scan(
      workspacePackage.directory,
    )) {
      const source = await Bun.file(join(workspacePackage.directory, sourcePath)).text()
      if (
        workspacePackage.name !== "@convax/project" &&
        !isTestSource(sourcePath) &&
        /\.convax\/(?:project\.json|canvas\.json|canvases(?:\/|\b))/i.test(source.replaceAll("\\", "/"))
      ) {
        throw new Error(
          `${sourcePath}: private Project metadata must be accessed through @convax/project ports, never by path`,
        )
      }
      const specifiers = [
        ...source.matchAll(/(?:from\s*|import\s*\(\s*|require(?:\.resolve)?\s*\(\s*)["']([^"']+)["']/g),
        ...source.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g),
      ].map((match) => match[1])
      for (const specifier of specifiers) {
        validateSpecifier(sourcePath, specifier)
        if (
          publishablePackageNames.has(workspacePackage.name) &&
          !isTestSource(sourcePath) &&
          !specifier.startsWith(".") &&
          !specifier.startsWith("/") &&
          !specifier.startsWith("file:") &&
          !specifier.startsWith("bun:") &&
          !nodeBuiltinSpecifiers.has(specifier) &&
          !packages.some((candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`))
        ) {
          const [first, second] = specifier.split("/")
          const dependencyName = first?.startsWith("@") ? `${first}/${second}` : first
          if (!dependencyName || !(dependencyName in runtimeDependencies)) {
            throw new Error(
              `${sourcePath}: external import ${specifier} must be a declared dependency or peer of ${workspacePackage.name}`,
            )
          }
        }
      }
    }
  }

  for await (const sourcePath of new Bun.Glob("src/**/*.css").scan(workspacePackage.directory)) {
    const source = await Bun.file(join(workspacePackage.directory, sourcePath)).text()
    for (const match of source.matchAll(/@(?:import|source)\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
      validateSpecifier(sourcePath, match[1])
    }
  }

  if (workspacePackage.name !== "@convax/agent-runtime") {
    const forbiddenDependency = Object.keys(runtimeDependencies).find(
      (dependency) => dependency === "opencode-ai" || dependency.startsWith("@opencode-ai/"),
    )
    if (forbiddenDependency) {
      throw new Error(`${workspacePackage.name}: ${forbiddenDependency} must stay behind @convax/agent-runtime`)
    }
  }
}

const cycle = findCycle(graph)
if (cycle) throw new Error(`package dependency cycle: ${cycle.join(" -> ")}`)

console.log(`package boundary check passed: ${packages.length} packages, architecture and runtime boundaries valid`)
