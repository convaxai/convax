import Ajv from "ajv"
import { OFFICIAL_SERVER_SCHEMA } from "./server-schema"
import { canonicalJson, sha256Hex } from "./canonical"

export type MarketplaceKind = "builtin" | "network" | "local"
export type MarketplaceItemKind = "plugin" | "skill" | "mcp-server"
export type Sha256 = string

export interface MarketplaceItemRef {
  marketplaceId: string
  kind: MarketplaceItemKind
  id: string
}

export interface Compatibility {
  convax: string
}

export interface Presentation {
  name: string
  description?: string
}

export interface ArtifactDelivery {
  kind: "artifact"
  url: string
  size: number
  sha256: Sha256
}

export interface BuiltinArtifactDelivery {
  kind: "builtin-artifact"
  bundleReleaseId: string
  path: string
  size: number
  sha256: Sha256
}

export type PluginCompanion = {
  command: string
  version: string
  targets: Array<{
    platform: "darwin" | "linux" | "win32"
    arch: "arm64" | "x64"
    artifact: { url: string; size: number; sha256: Sha256 }
  }>
}

export interface McpHttpDelivery {
  kind: "mcp-http"
  serverJson: Record<string, unknown>
  serverJsonSha256: Sha256
  runtime: {
    endpoint: string
    transport: "streamable-http" | "sse"
  }
}

export interface CompanionArtifact {
  target: string
  command: string
  url: string
  size: number
  sha256: Sha256
}

export interface McpManagedStdioDelivery {
  kind: "mcp-managed-stdio"
  serverJson: Record<string, unknown>
  serverJsonSha256: Sha256
  extension: McpServerExtension
  extensionSha256: Sha256
  companions: CompanionArtifact[]
}

export type MarketplaceDelivery = ArtifactDelivery | BuiltinArtifactDelivery | McpHttpDelivery | McpManagedStdioDelivery

export interface RegistryPackage {
  kind: MarketplaceItemKind
  id: string
  version: string
  compatibility: Compatibility
  presentation: Presentation
  delivery: MarketplaceDelivery
  yanked?: boolean
  manifest?: Record<string, unknown>
  companions?: PluginCompanion[]
  ownerPluginId?: string
}

export interface RegistryV2 {
  schema: "convax.registry/2"
  marketplaceId: string
  sequence: number
  revision: string
  packages: RegistryPackage[]
}

export interface MarketplaceDescriptor {
  schema: "convax.marketplace/1"
  id: string
  name: string
  publisher: { name: string }
  repository: { owner: string; name: string }
  registry: { v2: { url: string } }
  showcase: { v2: { url: string } }
  compatibility: Compatibility
  delivery: { kind: "github-pages-releases" }
}

export interface McpServerExtension {
  schema: "convax.mcp-server-extension/1"
  runtime: {
    kind: "managed-stdio"
    command: string
    argv: string[]
    compatibility: { targets: string[] }
  }
  productActions?: Array<{
    action: "canvas.import" | "canvas.export" | "project.files.read"
    tool: string
  }>
  grants?: Array<"canvas.read" | "canvas.write" | "project.files.read">
}

export interface ParsedServerPackage {
  id: string
  version: string
  definition: Record<string, unknown>
  runtime:
    | { kind: "http-agent"; endpoint: string; transport: "streamable-http" | "sse" }
    | { kind: "managed-stdio"; command: string; argv: readonly string[]; targets: readonly string[] }
  extension?: McpServerExtension
}

export type ServerPackageCatalogAdmission =
  | {
      supported: true
      package: ParsedServerPackage
    }
  | {
      supported: false
      id: string
      version: string
      definition: Record<string, unknown>
      reason: "no-supported-runtime"
    }

export interface BuiltinBundle {
  schema: "convax.builtin-bundle/1"
  release: { id: string }
  members: Array<{
    kind: "plugin" | "skill"
    id: string
    version: string
    artifact: { path: string; size: number; sha256: string }
    presentation: {
      poster: { path: string; mime: string; size: number; sha256: string }
      animation?: { path: string; mime: string; size: number; sha256: string }
    }
  }>
}

export interface ShowcaseAsset {
  url: string
  size: number
  sha256: Sha256
  mime: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "video/webm"
  alt?: string
  width?: number
  height?: number
}

export interface ShowcaseV2 {
  schema: "convax.showcase/2"
  marketplaceId: string
  revision: string
  packages: Array<{
    kind: MarketplaceItemKind
    id: string
    version: string
    presentation: {
      name: string
      description?: string
      poster: ShowcaseAsset
      animation?: ShowcaseAsset
    }
  }>
}

const ITEM_KINDS = new Set<MarketplaceItemKind>(["plugin", "skill", "mcp-server"])
const SHA256 = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const MARKETPLACE_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SAFE_OPAQUE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,254}$/
const PACKAGE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COMMAND = /^[A-Za-z0-9._-]+$/
const TARGET = /^(darwin|linux|win32)-(arm64|x64)$/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const admittedPluginHostApiMajor = 2
const officialServerAjv = new Ajv({
  strict: true,
  // The published MCP schema uses `required` inside `anyOf` branches while
  // declaring those properties in a sibling `allOf` branch. Ajv's
  // strictRequired lint rejects that valid published shape before validation.
  // Keep every other strict check enabled and disable only this schema lint.
  strictRequired: false,
  allErrors: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: false,
})
officialServerAjv.addKeyword({ keyword: "example", valid: true })
const validateOfficialServerSchema = officialServerAjv.compile(OFFICIAL_SERVER_SCHEMA)

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function strictKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} has unknown property ${key}`)
  }
  for (const key of required) {
    if (!(key in value)) throw new TypeError(`${label} is missing ${key}`)
  }
}

function string(value: unknown, label: string, max = 4_096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TypeError(`${label} must be a non-empty string of at most ${max} characters`)
  }
  return value
}

function integer(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value as number
}

function sha256(value: unknown, label: string): Sha256 {
  const parsed = string(value, label, 64)
  if (!SHA256.test(parsed)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`)
  return parsed
}

function canonicalJsonSha256(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(`${canonicalJson(value)}\n`))
}

function httpsUrl(value: unknown, label: string): string {
  const parsed = new URL(string(value, label))
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(`${label} must be an HTTPS URL without credentials, query, or fragment`)
  }
  return parsed.toString()
}

function immutableReleaseUrl(value: unknown, label: string): string {
  const parsed = new URL(httpsUrl(value, label))
  const segments = parsed.pathname.split("/").filter(Boolean)
  if (
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.port !== "" ||
    segments.length !== 6 ||
    parsed.pathname !== `/${segments.join("/")}` ||
    segments[2] !== "releases" ||
    segments[3] !== "download" ||
    segments[4]?.toLowerCase() === "latest" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(segments[4] ?? "") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(segments[5] ?? "")
  ) {
    throw new TypeError(`${label} must be an immutable GitHub Release asset URL`)
  }
  return parsed.toString()
}

function parseCompatibility(value: unknown): Compatibility {
  const parsed = record(value, "compatibility")
  strictKeys(parsed, ["convax"], ["convax"], "compatibility")
  return { convax: string(parsed.convax, "compatibility.convax", 128) }
}

function parsePresentation(value: unknown): Presentation {
  const parsed = record(value, "presentation")
  strictKeys(parsed, ["name", "description"], ["name"], "presentation")
  return {
    name: string(parsed.name, "presentation.name", 100),
    ...(parsed.description === undefined
      ? {}
      : { description: string(parsed.description, "presentation.description", 1_024) }),
  }
}

function parseArtifact(value: unknown): ArtifactDelivery {
  const parsed = record(value, "artifact delivery")
  strictKeys(parsed, ["kind", "url", "size", "sha256"], ["kind", "url", "size", "sha256"], "artifact delivery")
  if (parsed.kind !== "artifact") throw new TypeError("artifact delivery kind must be artifact")
  const size = integer(parsed.size, "artifact size", 128 * 1024 * 1024)
  if (size < 1) throw new TypeError("artifact size must be positive")
  return {
    kind: "artifact",
    url: immutableReleaseUrl(parsed.url, "artifact URL"),
    size,
    sha256: sha256(parsed.sha256, "artifact sha256"),
  }
}

export function parseMarketplaceDescriptor(value: unknown): MarketplaceDescriptor {
  const parsed = record(value, "marketplace descriptor")
  strictKeys(
    parsed,
    ["schema", "id", "name", "publisher", "repository", "registry", "showcase", "compatibility", "delivery"],
    ["schema", "id", "name", "publisher", "repository", "registry", "showcase", "compatibility", "delivery"],
    "marketplace descriptor",
  )
  if (parsed.schema !== "convax.marketplace/1") throw new TypeError("unsupported marketplace descriptor schema")
  const id = string(parsed.id, "marketplace id", 63)
  if (!MARKETPLACE_ID.test(id)) throw new TypeError("invalid marketplace id")
  const publisher = record(parsed.publisher, "publisher")
  strictKeys(publisher, ["name"], ["name"], "publisher")
  const repository = record(parsed.repository, "repository")
  strictKeys(repository, ["owner", "name"], ["owner", "name"], "repository")
  const registry = record(parsed.registry, "registry")
  strictKeys(registry, ["v2"], ["v2"], "registry")
  const v2 = record(registry.v2, "registry.v2")
  strictKeys(v2, ["url"], ["url"], "registry.v2")
  const showcase = record(parsed.showcase, "showcase")
  strictKeys(showcase, ["v2"], ["v2"], "showcase")
  const showcaseV2 = record(showcase.v2, "showcase.v2")
  strictKeys(showcaseV2, ["url"], ["url"], "showcase.v2")
  const delivery = record(parsed.delivery, "delivery")
  strictKeys(delivery, ["kind"], ["kind"], "delivery")
  if (delivery.kind !== "github-pages-releases") throw new TypeError("unsupported delivery policy")
  const owner = string(repository.owner, "repository owner", 100)
  const repositoryName = string(repository.name, "repository name", 100)
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repositoryName) ||
    repositoryName === "." ||
    repositoryName === ".."
  ) {
    throw new TypeError("repository owner/name must be valid GitHub repository path segments")
  }
  const assertPagesUrl = (raw: unknown, label: string): string => {
    const url = new URL(httpsUrl(raw, label))
    const expectedHost = `${owner.toLowerCase()}.github.io`
    const segments = url.pathname.split("/").filter(Boolean)
    if (
      url.hostname.toLowerCase() !== expectedHost ||
      url.port !== "" ||
      !url.pathname.startsWith(`/${repositoryName}/`) ||
      url.pathname !== `/${segments.join("/")}` ||
      segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(segment)) ||
      url.search
    ) {
      throw new TypeError(`${label} must use the declared repository GitHub Pages origin`)
    }
    return url.toString()
  }
  return {
    schema: "convax.marketplace/1",
    id,
    name: string(parsed.name, "marketplace name", 100),
    publisher: { name: string(publisher.name, "publisher name", 100) },
    repository: {
      owner,
      name: repositoryName,
    },
    registry: {
      v2: { url: assertPagesUrl(v2.url, "registry.v2.url") },
    },
    showcase: { v2: { url: assertPagesUrl(showcaseV2.url, "showcase.v2.url") } },
    compatibility: parseCompatibility(parsed.compatibility),
    delivery: { kind: "github-pages-releases" },
  }
}

export function parseMcpServerExtension(value: unknown): McpServerExtension {
  const parsed = record(value, "MCP extension")
  strictKeys(parsed, ["schema", "runtime", "productActions", "grants"], ["schema", "runtime"], "MCP extension")
  if (parsed.schema !== "convax.mcp-server-extension/1") throw new TypeError("unsupported MCP extension schema")
  const runtime = record(parsed.runtime, "MCP runtime")
  strictKeys(
    runtime,
    ["kind", "command", "argv", "compatibility"],
    ["kind", "command", "argv", "compatibility"],
    "MCP runtime",
  )
  if (runtime.kind !== "managed-stdio") throw new TypeError("MCP extension must use managed-stdio")
  const command = string(runtime.command, "MCP command", 128)
  if (!COMMAND.test(command) || WINDOWS_RESERVED.test(command)) throw new TypeError("invalid bare MCP command")
  if (!Array.isArray(runtime.argv) || runtime.argv.length > 32) throw new TypeError("MCP argv must be a bounded array")
  const argv = runtime.argv.map((arg, index) => {
    const parsedArg = string(arg, `MCP argv[${index}]`, 1_024)
    if (parsedArg.includes("\0")) throw new TypeError("MCP argv cannot contain NUL")
    return parsedArg
  })
  const compatibility = record(runtime.compatibility, "MCP runtime compatibility")
  strictKeys(compatibility, ["targets"], ["targets"], "MCP runtime compatibility")
  if (!Array.isArray(compatibility.targets) || compatibility.targets.length === 0 || compatibility.targets.length > 8) {
    throw new TypeError("MCP runtime must declare bounded targets")
  }
  const targets = compatibility.targets.map((target) => string(target, "MCP target", 32))
  if (new Set(targets).size !== targets.length || targets.some((target) => !TARGET.test(target))) {
    throw new TypeError("invalid or duplicate MCP target")
  }
  const actionNames = new Set(["canvas.import", "canvas.export", "project.files.read"])
  const productActions =
    parsed.productActions === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(parsed.productActions) || parsed.productActions.length > 32) {
            throw new TypeError("MCP product actions must be bounded")
          }
          return parsed.productActions.map((entry) => {
            const action = record(entry, "MCP product action")
            strictKeys(action, ["action", "tool"], ["action", "tool"], "MCP product action")
            const actionName = string(action.action, "MCP product action name", 64)
            if (!actionNames.has(actionName)) throw new TypeError("unsupported MCP product action")
            return {
              action: actionName as "canvas.import" | "canvas.export" | "project.files.read",
              tool: string(action.tool, "MCP product tool", 128),
            }
          })
        })()
  const grantNames = new Set(["canvas.read", "canvas.write", "project.files.read"])
  const grants =
    parsed.grants === undefined
      ? undefined
      : (() => {
          if (!Array.isArray(parsed.grants) || parsed.grants.length > 16)
            throw new TypeError("MCP grants must be bounded")
          return parsed.grants.map((grant) => {
            const name = string(grant, "MCP grant", 64)
            if (!grantNames.has(name)) throw new TypeError("unsupported MCP grant")
            return name as "canvas.read" | "canvas.write" | "project.files.read"
          })
        })()
  return {
    schema: "convax.mcp-server-extension/1",
    runtime: { kind: "managed-stdio", command, argv, compatibility: { targets } },
    ...(productActions ? { productActions } : {}),
    ...(grants ? { grants } : {}),
  }
}

function parseDelivery(
  value: unknown,
  packageKind: MarketplaceItemKind,
): ArtifactDelivery | McpHttpDelivery | McpManagedStdioDelivery {
  const parsed = record(value, "delivery")
  if (parsed.kind === "artifact") {
    if (packageKind === "mcp-server") throw new TypeError("MCP Server cannot use a static artifact delivery")
    return parseArtifact(parsed)
  }
  if (packageKind !== "mcp-server") throw new TypeError("only MCP Server may use MCP delivery")
  if (parsed.kind === "mcp-http") {
    strictKeys(
      parsed,
      ["kind", "serverJson", "serverJsonSha256", "runtime"],
      ["kind", "serverJson", "serverJsonSha256", "runtime"],
      "MCP HTTP delivery",
    )
    const definition = record(parsed.serverJson, "serverJson")
    const server = parseServerPackage(definition)
    if (server.runtime.kind !== "http-agent") throw new TypeError("MCP HTTP delivery must contain HTTP definition")
    const runtime = record(parsed.runtime, "MCP HTTP runtime")
    strictKeys(runtime, ["endpoint", "transport"], ["endpoint", "transport"], "MCP HTTP runtime")
    if (runtime.endpoint !== server.runtime.endpoint || runtime.transport !== server.runtime.transport) {
      throw new TypeError("MCP HTTP runtime does not match server.json")
    }
    const serverJsonSha256 = sha256(parsed.serverJsonSha256, "serverJsonSha256")
    if (serverJsonSha256 !== canonicalJsonSha256(definition)) {
      throw new TypeError("serverJsonSha256 does not match canonical server.json bytes")
    }
    return {
      kind: "mcp-http",
      serverJson: definition,
      serverJsonSha256,
      runtime: { endpoint: server.runtime.endpoint, transport: server.runtime.transport },
    }
  }
  if (parsed.kind === "mcp-managed-stdio") {
    strictKeys(
      parsed,
      ["kind", "serverJson", "serverJsonSha256", "extension", "extensionSha256", "companions"],
      ["kind", "serverJson", "serverJsonSha256", "extension", "extensionSha256", "companions"],
      "managed MCP delivery",
    )
    const definition = record(parsed.serverJson, "serverJson")
    const extension = parseMcpServerExtension(parsed.extension)
    parseServerPackage(definition, extension)
    if (!Array.isArray(parsed.companions) || parsed.companions.length === 0 || parsed.companions.length > 8) {
      throw new TypeError("managed MCP delivery must contain bounded companions")
    }
    const companions = parsed.companions.map((entry) => {
      const companion = record(entry, "companion")
      strictKeys(
        companion,
        ["target", "command", "url", "size", "sha256"],
        ["target", "command", "url", "size", "sha256"],
        "companion",
      )
      const target = string(companion.target, "companion target", 32)
      if (!TARGET.test(target)) throw new TypeError("invalid companion target")
      const command = string(companion.command, "companion command", 128)
      if (command !== extension.runtime.command) throw new TypeError("companion command does not match extension")
      const size = integer(companion.size, "companion size", 128 * 1024 * 1024)
      if (size < 1) throw new TypeError("companion size must be positive")
      return {
        target,
        command,
        url: immutableReleaseUrl(companion.url, "companion URL"),
        size,
        sha256: sha256(companion.sha256, "companion sha256"),
      }
    })
    if (new Set(companions.map(({ target }) => target)).size !== companions.length) {
      throw new TypeError("duplicate companion target")
    }
    if (companions.some(({ target }) => !extension.runtime.compatibility.targets.includes(target))) {
      throw new TypeError("companion target is outside extension compatibility")
    }
    const serverJsonSha256 = sha256(parsed.serverJsonSha256, "serverJsonSha256")
    if (serverJsonSha256 !== canonicalJsonSha256(definition)) {
      throw new TypeError("serverJsonSha256 does not match canonical server.json bytes")
    }
    const extensionSha256 = sha256(parsed.extensionSha256, "extensionSha256")
    if (extensionSha256 !== canonicalJsonSha256(extension)) {
      throw new TypeError("extensionSha256 does not match canonical extension bytes")
    }
    return {
      kind: "mcp-managed-stdio",
      serverJson: definition,
      serverJsonSha256,
      extension,
      extensionSha256,
      companions,
    }
  }
  throw new TypeError("unsupported delivery kind")
}

function parseRegistryPackage(value: unknown): RegistryPackage {
  const parsed = record(value, "registry package")
  strictKeys(
    parsed,
    [
      "kind",
      "id",
      "version",
      "compatibility",
      "presentation",
      "delivery",
      "yanked",
      "manifest",
      "companions",
      "ownerPluginId",
    ],
    ["kind", "id", "version", "compatibility", "presentation", "delivery"],
    "registry package",
  )
  if (!ITEM_KINDS.has(parsed.kind as MarketplaceItemKind)) throw new TypeError("unsupported package kind")
  const kind = parsed.kind as MarketplaceItemKind
  const id = string(parsed.id, "package id", 200)
  if (!ID.test(id)) throw new TypeError("invalid package id")
  const version = string(parsed.version, "package version", 255)
  if (kind === "mcp-server" ? !SAFE_OPAQUE_VERSION.test(version) : !SEMVER.test(version)) {
    throw new TypeError(`${kind} version is unsafe or unsupported`)
  }
  const delivery = parseDelivery(parsed.delivery, kind)
  if (parsed.yanked !== undefined && typeof parsed.yanked !== "boolean") throw new TypeError("yanked must be boolean")
  if (kind === "plugin" && parsed.manifest === undefined) {
    throw new TypeError("Plugin Registry package must project its manifest")
  }
  if (kind === "plugin") {
    const manifest = record(parsed.manifest, "Plugin manifest projection")
    if (manifest.schema !== "convax.plugin/8" || manifest.id !== id || manifest.version !== version) {
      if (manifest.id !== id || manifest.version !== version) {
        throw new TypeError("Plugin manifest identity must match its Registry entry")
      }
      throw new TypeError("Plugin manifest schema is unsupported")
    }
    const hostApi = record(manifest.hostApi, "Plugin manifest hostApi")
    strictKeys(hostApi, ["major", "required", "optional"], ["major", "required", "optional"], "Plugin manifest hostApi")
    const apiId = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/
    if (hostApi.major !== admittedPluginHostApiMajor) {
      throw new TypeError(`Plugin manifest hostApi major must be ${admittedPluginHostApiMajor}`)
    }
    if (
      !Array.isArray(hostApi.required) ||
      !Array.isArray(hostApi.optional) ||
      [...hostApi.required, ...hostApi.optional].some((api) => typeof api !== "string" || !apiId.test(api))
    ) {
      throw new TypeError("Plugin manifest hostApi declaration is invalid")
    }
    const requiredApis = hostApi.required as string[]
    const optionalApis = hostApi.optional as string[]
    if (
      new Set(requiredApis).size !== requiredApis.length ||
      new Set(optionalApis).size !== optionalApis.length ||
      optionalApis.some((api) => requiredApis.includes(api))
    ) {
      throw new TypeError("Plugin manifest hostApi declaration contains duplicate or overlapping APIs")
    }
  }
  if (kind !== "plugin" && parsed.manifest !== undefined) throw new TypeError("only Plugin may project a manifest")
  const companions: PluginCompanion[] | undefined =
    parsed.companions === undefined
      ? undefined
      : (() => {
          if (
            kind !== "plugin" ||
            !Array.isArray(parsed.companions) ||
            parsed.companions.length === 0 ||
            parsed.companions.length > 16
          ) {
            throw new TypeError("Plugin companions must be a bounded array")
          }
          const parsedCompanions = parsed.companions.map((entry) => {
            const companion = record(entry, "Plugin companion")
            strictKeys(
              companion,
              ["command", "version", "targets"],
              ["command", "version", "targets"],
              "Plugin companion",
            )
            const command = string(companion.command, "Plugin companion command", 128)
            if (!COMMAND.test(command) || WINDOWS_RESERVED.test(command))
              throw new TypeError("invalid Plugin companion command")
            const version = string(companion.version, "Plugin companion version", 255)
            if (!SEMVER.test(version)) throw new TypeError("Plugin companion version must be SemVer")
            if (!Array.isArray(companion.targets) || companion.targets.length === 0 || companion.targets.length > 16) {
              throw new TypeError("Plugin companion targets must be bounded")
            }
            const targets = companion.targets.map((targetValue): PluginCompanion["targets"][number] => {
              const target = record(targetValue, "Plugin companion target")
              strictKeys(
                target,
                ["platform", "arch", "artifact"],
                ["platform", "arch", "artifact"],
                "Plugin companion target",
              )
              let platform: PluginCompanion["targets"][number]["platform"]
              switch (target.platform) {
                case "darwin":
                case "linux":
                case "win32":
                  platform = target.platform
                  break
                default:
                  throw new TypeError("invalid companion platform")
              }
              let arch: PluginCompanion["targets"][number]["arch"]
              switch (target.arch) {
                case "arm64":
                case "x64":
                  arch = target.arch
                  break
                default:
                  throw new TypeError("invalid companion architecture")
              }
              const artifactValue = record(target.artifact, "Plugin companion artifact")
              strictKeys(
                artifactValue,
                ["url", "size", "sha256"],
                ["url", "size", "sha256"],
                "Plugin companion artifact",
              )
              const size = integer(artifactValue.size, "Plugin companion size", 128 * 1024 * 1024)
              if (size < 1) throw new TypeError("Plugin companion size must be positive")
              return {
                platform,
                arch,
                artifact: {
                  url: immutableReleaseUrl(artifactValue.url, "Plugin companion URL"),
                  size,
                  sha256: sha256(artifactValue.sha256, "Plugin companion sha256"),
                },
              }
            })
            if (new Set(targets.map((target) => `${target.platform}-${target.arch}`)).size !== targets.length) {
              throw new TypeError("duplicate Plugin companion target")
            }
            return {
              command,
              version,
              targets,
            }
          })
          if (new Set(parsedCompanions.map(({ command }) => command)).size !== parsedCompanions.length) {
            throw new TypeError("duplicate Plugin companion command")
          }
          return parsedCompanions
        })()
  if (kind !== "skill" && parsed.ownerPluginId !== undefined)
    throw new TypeError("only Skill may declare ownerPluginId")
  if (kind === "mcp-server") {
    const serverJson = delivery.kind === "artifact" ? undefined : delivery.serverJson
    if (serverJson?.name !== id || serverJson.version !== version) {
      throw new TypeError("MCP registry identity must match server.json name/version")
    }
  }
  return {
    kind,
    id,
    version,
    compatibility: parseCompatibility(parsed.compatibility),
    presentation: parsePresentation(parsed.presentation),
    delivery,
    ...(parsed.yanked === undefined ? {} : { yanked: parsed.yanked }),
    ...(parsed.manifest === undefined ? {} : { manifest: parsed.manifest as Record<string, unknown> }),
    ...(companions ? { companions } : {}),
    ...(parsed.ownerPluginId === undefined ? {} : { ownerPluginId: string(parsed.ownerPluginId, "ownerPluginId", 80) }),
  }
}

export function parseRegistryV2(value: unknown): RegistryV2 {
  const parsed = record(value, "registry")
  strictKeys(
    parsed,
    ["schema", "marketplaceId", "sequence", "revision", "packages"],
    ["schema", "marketplaceId", "sequence", "revision", "packages"],
    "registry",
  )
  if (parsed.schema !== "convax.registry/2") throw new TypeError("unsupported Registry schema")
  if (!Array.isArray(parsed.packages) || parsed.packages.length > 16_384) {
    throw new TypeError("Registry packages must be a bounded array")
  }
  const packages = parsed.packages.map(parseRegistryPackage)
  const identities = new Set<string>()
  for (const entry of packages) {
    const identity = `${entry.kind}\0${entry.id}`
    if (identities.has(identity)) throw new TypeError(`duplicate Registry identity ${entry.kind}/${entry.id}`)
    identities.add(identity)
  }
  const marketplaceId = string(parsed.marketplaceId, "marketplaceId", 63)
  if (!MARKETPLACE_ID.test(marketplaceId)) throw new TypeError("marketplaceId must be a lowercase Marketplace slug")
  const sequence = integer(parsed.sequence, "sequence")
  if (sequence < 1) throw new TypeError("Registry sequence must be positive")
  const revision = string(parsed.revision, "revision", 64)
  if (!SHA256.test(revision)) throw new TypeError("Registry revision must be a 64-character lowercase content SHA-256")
  if (revision !== sha256Hex(canonicalJson(packages))) {
    throw new TypeError("Registry revision does not match canonical package content")
  }
  return {
    schema: "convax.registry/2",
    marketplaceId,
    sequence,
    revision,
    packages,
  }
}

export function parseShowcaseV2(value: unknown, registry: RegistryV2, descriptor: MarketplaceDescriptor): ShowcaseV2 {
  if (descriptor.id !== registry.marketplaceId) {
    throw new TypeError("Showcase descriptor does not match Registry Marketplace")
  }
  const parsed = record(value, "Showcase")
  strictKeys(
    parsed,
    ["schema", "marketplaceId", "revision", "packages"],
    ["schema", "marketplaceId", "revision", "packages"],
    "Showcase",
  )
  if (parsed.schema !== "convax.showcase/2") throw new TypeError("unsupported Showcase schema")
  if (parsed.marketplaceId !== registry.marketplaceId || parsed.revision !== registry.revision) {
    throw new TypeError("Showcase source identity/revision does not match Registry")
  }
  if (!Array.isArray(parsed.packages) || parsed.packages.length > registry.packages.length) {
    throw new TypeError("Showcase packages must be bounded by the Registry")
  }
  const registryByIdentity = new Map(registry.packages.map((entry) => [`${entry.kind}\0${entry.id}`, entry]))
  const identities = new Set<string>()
  const parseShowcaseAsset = (
    value: unknown,
    label: string,
    allowedMime: ReadonlySet<string>,
    maxSize: number,
  ): ShowcaseAsset => {
    const asset = record(value, label)
    strictKeys(
      asset,
      ["url", "size", "sha256", "mime", "alt", "width", "height"],
      ["url", "size", "sha256", "mime"],
      label,
    )
    const mime = string(asset.mime, `${label}.mime`, 32)
    if (!allowedMime.has(mime)) throw new TypeError(`${label}.mime is unsupported`)
    const size = integer(asset.size, `${label}.size`, maxSize)
    if (size < 1) throw new TypeError(`${label}.size must be positive`)
    if ((asset.width === undefined) !== (asset.height === undefined)) {
      throw new TypeError(`${label} dimensions must be declared together`)
    }
    const width = asset.width === undefined ? undefined : integer(asset.width, `${label}.width`, 8_192)
    const height = asset.height === undefined ? undefined : integer(asset.height, `${label}.height`, 8_192)
    if (width === 0 || height === 0) throw new TypeError(`${label} dimensions must be positive`)
    const url = new URL(httpsUrl(asset.url, `${label}.url`))
    const expectedPrefix = `/${descriptor.repository.owner}/${descriptor.repository.name}/releases/download/`
    const immutableSegments = url.pathname.slice(expectedPrefix.length).split("/")
    const expectedTag = `registry-v2-${registry.revision}`
    if (
      url.hostname.toLowerCase() !== "github.com" ||
      url.port !== "" ||
      !url.pathname.startsWith(expectedPrefix) ||
      immutableSegments.length !== 2 ||
      immutableSegments[0] !== expectedTag ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(immutableSegments[0] ?? "") ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(immutableSegments[1] ?? "")
    ) {
      throw new TypeError(
        `${label}.url must be an immutable Registry revision Release asset in the declared repository`,
      )
    }
    return {
      url: url.toString(),
      size,
      sha256: sha256(asset.sha256, `${label}.sha256`),
      mime: mime as ShowcaseAsset["mime"],
      ...(asset.alt === undefined ? {} : { alt: string(asset.alt, `${label}.alt`, 512) }),
      ...(width === undefined ? {} : { width, height: height! }),
    }
  }
  const packages = parsed.packages.map((packageValue): ShowcaseV2["packages"][number] => {
    const entry = record(packageValue, "Showcase package")
    strictKeys(
      entry,
      ["kind", "id", "version", "presentation"],
      ["kind", "id", "version", "presentation"],
      "Showcase package",
    )
    if (!ITEM_KINDS.has(entry.kind as MarketplaceItemKind)) throw new TypeError("unsupported Showcase package kind")
    const kind = entry.kind as MarketplaceItemKind
    const id = string(entry.id, "Showcase package id", 200)
    const version = string(entry.version, "Showcase package version", 255)
    const identity = `${kind}\0${id}`
    if (identities.has(identity)) throw new TypeError(`duplicate Showcase identity ${kind}/${id}`)
    identities.add(identity)
    const registryEntry = registryByIdentity.get(identity)
    if (!registryEntry || registryEntry.version !== version) {
      throw new TypeError(`Showcase package ${kind}/${id}@${version} does not match Registry`)
    }
    const presentation = record(entry.presentation, "Showcase presentation")
    strictKeys(
      presentation,
      ["name", "description", "poster", "animation"],
      ["name", "poster"],
      "Showcase presentation",
    )
    return {
      kind,
      id,
      version,
      presentation: {
        name: string(presentation.name, "Showcase presentation.name", 100),
        ...(presentation.description === undefined
          ? {}
          : { description: string(presentation.description, "Showcase presentation.description", 1_024) }),
        poster: parseShowcaseAsset(
          presentation.poster,
          "Showcase poster",
          new Set(["image/png", "image/jpeg", "image/webp"]),
          16 * 1024 * 1024,
        ),
        ...(presentation.animation === undefined
          ? {}
          : {
              animation: parseShowcaseAsset(
                presentation.animation,
                "Showcase animation",
                new Set(["video/mp4", "video/webm"]),
                64 * 1024 * 1024,
              ),
            }),
      },
    }
  })
  return {
    schema: "convax.showcase/2",
    marketplaceId: registry.marketplaceId,
    revision: registry.revision,
    packages,
  }
}

export function parseBuiltinBundle(value: unknown): BuiltinBundle {
  const parsed = record(value, "Builtin bundle")
  strictKeys(parsed, ["schema", "release", "members"], ["schema", "release", "members"], "Builtin bundle")
  if (parsed.schema !== "convax.builtin-bundle/1") throw new TypeError("unsupported Builtin bundle schema")
  const release = record(parsed.release, "Builtin release")
  strictKeys(release, ["id"], ["id"], "Builtin release")
  if (!Array.isArray(parsed.members) || parsed.members.length === 0 || parsed.members.length > 128) {
    throw new TypeError("Builtin members must be a bounded non-empty array")
  }
  const paths = new Set<string>()
  const identities = new Set<string>()
  const members: BuiltinBundle["members"] = parsed.members.map((memberValue) => {
    const member = record(memberValue, "Builtin member")
    strictKeys(
      member,
      ["kind", "id", "version", "artifact", "presentation"],
      ["kind", "id", "version", "artifact", "presentation"],
      "Builtin member",
    )
    if (member.kind !== "plugin" && member.kind !== "skill")
      throw new TypeError("Builtin V1 admits only Plugin and Skill")
    const parseMemberArtifact = (value: unknown, label: string) => {
      const artifact = record(value, label)
      strictKeys(artifact, ["path", "size", "sha256"], ["path", "size", "sha256"], label)
      const path = string(artifact.path, `${label}.path`, 256)
      if (!/^([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path) || path.includes(".."))
        throw new TypeError(`${label}.path is unsafe`)
      if (paths.has(path)) throw new TypeError(`duplicate Builtin artifact path ${path}`)
      paths.add(path)
      const size = integer(artifact.size, `${label}.size`, 128 * 1024 * 1024)
      if (size < 1) throw new TypeError(`${label}.size must be positive`)
      return {
        path,
        size,
        sha256: sha256(artifact.sha256, `${label}.sha256`),
      }
    }
    const id = string(member.id, "Builtin member id", 200)
    if (!PACKAGE_SLUG.test(id) || id.length > 80) throw new TypeError("Builtin member id must be a lowercase slug")
    const identity = `${member.kind}\0${id}`
    if (identities.has(identity)) throw new TypeError(`duplicate Builtin member ${member.kind}/${id}`)
    identities.add(identity)
    const presentation = record(member.presentation, "Builtin member presentation")
    strictKeys(presentation, ["poster", "animation"], ["poster"], "Builtin member presentation")
    const parsePresentationArtifact = (value: unknown, label: string) => {
      const asset = record(value, label)
      strictKeys(asset, ["path", "mime", "size", "sha256"], ["path", "mime", "size", "sha256"], label)
      const mime = string(asset.mime, `${label}.mime`, 100)
      const allowed =
        label === "Builtin poster"
          ? new Set(["image/png", "image/jpeg", "image/webp"])
          : new Set(["video/mp4", "video/webm"])
      if (!allowed.has(mime)) throw new TypeError(`${label}.mime is unsupported`)
      return {
        ...parseMemberArtifact({ path: asset.path, size: asset.size, sha256: asset.sha256 }, label),
        mime,
      }
    }
    return {
      kind: member.kind,
      id,
      version: (() => {
        const version = string(member.version, "Builtin member version", 255)
        if (!SEMVER.test(version)) throw new TypeError("Builtin member version must be SemVer")
        return version
      })(),
      artifact: parseMemberArtifact(member.artifact, "Builtin member artifact"),
      presentation: {
        poster: parsePresentationArtifact(presentation.poster, "Builtin poster"),
        ...(presentation.animation === undefined
          ? {}
          : { animation: parsePresentationArtifact(presentation.animation, "Builtin animation") }),
      },
    }
  })
  const releaseId = (() => {
    const id = string(release.id, "Builtin release id", 64)
    if (!SHA256.test(id)) throw new TypeError("Builtin release id must be a lowercase content SHA-256")
    return id
  })()
  const expectedReleaseId = sha256Hex(canonicalJson(members))
  if (releaseId !== expectedReleaseId) {
    throw new TypeError("Builtin release id must equal the canonical member content digest")
  }
  return {
    schema: "convax.builtin-bundle/1",
    release: { id: releaseId },
    members,
  }
}

export function classifyServerPackageForCatalog(
  definitionValue: unknown,
  extensionValue?: unknown,
): ServerPackageCatalogAdmission {
  if (!validateOfficialServerSchema(definitionValue)) {
    const first = validateOfficialServerSchema.errors?.[0]
    const boundedPath = (first?.instancePath || "/").slice(0, 160)
    const boundedKeyword = (first?.keyword || "invalid").slice(0, 64)
    throw new TypeError(`server.json does not match the vendored official schema at ${boundedPath} (${boundedKeyword})`)
  }
  const definition = record(definitionValue, "server.json")
  const name = string(definition.name, "server.json.name", 200)
  if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(name)) throw new TypeError("invalid server.json name")
  const description = string(definition.description, "server.json.description", 100)
  void description
  const version = string(definition.version, "server.json.version", 255)
  if (!SAFE_OPAQUE_VERSION.test(version)) throw new TypeError("server.json.version is unsafe")
  const extension = extensionValue === undefined ? undefined : parseMcpServerExtension(extensionValue)
  if (extension) {
    if (
      (Array.isArray(definition.remotes) && definition.remotes.length > 0) ||
      (Array.isArray(definition.packages) && definition.packages.length > 0)
    ) {
      throw new TypeError("mixed HTTP and managed-stdio profiles are forbidden")
    }
    return {
      supported: true,
      package: {
        id: name,
        version,
        definition,
        runtime: {
          kind: "managed-stdio",
          command: extension.runtime.command,
          argv: extension.runtime.argv,
          targets: extension.runtime.compatibility.targets,
        },
        extension,
      },
    }
  }
  const remotes = Array.isArray(definition.remotes) ? definition.remotes : []
  const supported = remotes.flatMap((entry) => {
    const candidate = record(entry, "server.json remote")
    if (candidate.type !== "streamable-http" && candidate.type !== "sse") return []
    if (candidate.variables !== undefined || candidate.headers !== undefined) return []
    if (typeof candidate.url !== "string" || /[{}]/.test(candidate.url)) return []
    try {
      const endpoint = httpsUrl(candidate.url, "MCP endpoint")
      return [{ endpoint, transport: candidate.type }]
    } catch {
      return []
    }
  })
  if (supported.length === 0) {
    return {
      supported: false,
      id: name,
      version,
      definition,
      reason: "no-supported-runtime",
    }
  }
  if (supported.length > 1) throw new TypeError("server.json must contain exactly one supported fixed HTTPS remote")
  const selected = supported[0]
  return {
    supported: true,
    package: {
      id: name,
      version,
      definition,
      runtime: {
        kind: "http-agent",
        endpoint: selected.endpoint,
        transport: selected.transport as "streamable-http" | "sse",
      },
    },
  }
}

export function parseServerPackage(definitionValue: unknown, extensionValue?: unknown): ParsedServerPackage {
  const admission = classifyServerPackageForCatalog(definitionValue, extensionValue)
  if (!admission.supported) {
    throw new TypeError("server.json must contain exactly one supported fixed HTTPS remote")
  }
  return admission.package
}
