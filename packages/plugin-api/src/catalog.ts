import {
  definePluginApi,
  definePluginApiCatalog,
  definePluginApiRelease,
  type PluginApiDefinitionInput,
} from "./contracts"
import { pluginApiContractIds, type PluginApiContractId } from "./method-contracts"

const contextErrors = [
  {
    code: "stale-context",
    description: "The bound Project, Canvas, node, or connection changed before the call completed.",
    recoverable: true,
  },
] as const

const permissionErrors = [
  {
    code: "permission-denied",
    description: "The installed Plugin principal does not currently hold the required grant.",
    recoverable: false,
  },
] as const

const resourceErrors = [
  {
    code: "resource-unavailable",
    description: "The authoritative Project resource is missing, changed, or cannot be read safely.",
    recoverable: true,
  },
] as const

const partialSuccessErrors = [
  {
    code: "partial-success",
    description:
      "A user-visible Project file was published, but the requested Canvas commit did not complete; retry is unsafe.",
    recoverable: false,
  },
] as const

const defineV2Contract = <const Definition extends Omit<PluginApiDefinitionInput, "contractSince">>(
  definition: Definition,
) =>
  definePluginApi({
    ...definition,
    contractSince: "2.0.0",
  })

const defineV3Contract = <const Definition extends Omit<PluginApiDefinitionInput, "contractSince">>(
  definition: Definition,
) =>
  definePluginApi({
    ...definition,
    contractSince: "3.0.0",
  })

export const pluginApiCatalog = definePluginApiCatalog(
  definePluginApiRelease("1.0.0", [
    defineV3Contract({
      id: "host.context.get",
      completion: "cancelable",
      grant: null,
      scope: "connection",
      sideEffect: "read",
      errors: contextErrors,
      docs: {
        summary: "Read the bounded context attached to the current Plugin connection.",
        description:
          "Returns only renderer-safe identifiers and feature metadata for the exact live connection; it grants no additional authority.",
        request: "No parameters.",
        response: "The current Plugin, Project, Canvas, node, and negotiated Host API context when present.",
      },
    }),
    defineV2Contract({
      id: "canvas.inputs.list",
      completion: "cancelable",
      grant: "canvas.connectedInputs.read",
      scope: "own-node",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "List direct incoming inputs of the owning Plugin node.",
        description:
          "Derives pathless input metadata from authoritative direct incoming Canvas edges and never reads resource bytes.",
        request: "No parameters; the owning node comes from the bound connection.",
        response: "A bounded list of direct incoming input descriptors and opaque input keys.",
      },
    }),
    defineV2Contract({
      id: "canvas.inputs.open",
      completion: "cancelable",
      grant: "canvas.connectedMedia.stream",
      scope: "own-node",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors, ...resourceErrors],
      docs: {
        summary: "Open a bounded stream for one previously listed direct input.",
        description:
          "Opens host-owned access to the exact authoritative input after topology and resource identity are revalidated.",
        request: "`{ inputKey }`, using an opaque key returned by canvas.inputs.list.",
        response: "A connection-bound stream descriptor and safe media metadata.",
        remarks: "Call canvas.inputs.close when the stream is no longer needed.",
      },
    }),
    defineV2Contract({
      id: "canvas.inputs.close",
      completion: "cancelable",
      grant: "canvas.connectedMedia.stream",
      scope: "own-node",
      sideEffect: "write",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Close one connection-bound input stream.",
        description: "Releases a stream created by canvas.inputs.open without changing Canvas or Project state.",
        request: "The stream handle returned by canvas.inputs.open.",
        response: "An acknowledgement; closing an already closed handle is idempotent.",
      },
    }),
    defineV3Contract({
      id: "canvas.node.get",
      completion: "cancelable",
      grant: "canvas.node.read",
      scope: "own-node",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Read the owning Plugin node projection.",
        description: "Returns a bounded renderer-safe projection of the exact node bound to the connection.",
        request: "No parameters; the owning node comes from the bound connection.",
        response: "The owning node identity, geometry, and Plugin state projection.",
      },
    }),
    defineV3Contract({
      id: "canvas.node.state.replace",
      completion: "commit-preserving",
      grant: "canvas.node.write",
      scope: "own-node",
      sideEffect: "write",
      errors: [...contextErrors, ...permissionErrors, ...resourceErrors],
      docs: {
        summary: "Replace the owning node's bounded Plugin state.",
        description:
          "Commits only the namespaced Plugin state through one Canvas-owned semantic intent guarded by the current node incarnation.",
        request: "`{ state }`, where state is a bounded JSON value.",
        response: "The durable operation receipt and current owning-node projection after the replacement commits.",
      },
    }),
    defineV3Contract({
      id: "canvas.resource.image.create",
      completion: "commit-preserving",
      grant: "canvas.image.write",
      scope: "own-node",
      sideEffect: "write",
      errors: [...contextErrors, ...permissionErrors, ...partialSuccessErrors],
      docs: {
        summary: "Create a Project-backed Canvas image through the host lifecycle.",
        description:
          "Admits bounded image content as a user-visible Project resource and commits its Canvas reference without exposing native paths.",
        request: "`{ dataUrl, name }`, containing a bounded validated image data URL and safe file name.",
        response: "The created renderer-safe image result after Project publication and Canvas commit.",
      },
    }),
    defineV2Contract({
      id: "project.file.text.read",
      completion: "cancelable",
      grant: "project.files.read",
      scope: "project",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Read one bounded UTF-8 Project file.",
        description:
          "Reads through the scoped Project Files capability using a normalized Project-relative path and never exposes a native path.",
        request: "`{ path }`, using a normalized Project-relative portable path.",
        response: "The bounded UTF-8 file text.",
      },
    }),
    defineV2Contract({
      id: "agent.prompt",
      completion: "commit-preserving",
      grant: "agent.prompt",
      scope: "connection",
      sideEffect: "execute",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Submit a bounded prompt through the host Agent capability.",
        description:
          "Uses the current host-owned Agent context; it does not grant direct OpenCode, filesystem, model, or credential access.",
        request: "`{ text }`, containing the bounded prompt text.",
        response: "`{ text }`, containing the bounded host acknowledgement.",
      },
    }),
    defineV2Contract({
      id: "generation.tools.list",
      completion: "cancelable",
      grant: "generation.execute",
      scope: "plugin",
      sideEffect: "read",
      errors: permissionErrors,
      docs: {
        summary: "List generation tools available to the installed Plugin principal.",
        description:
          "Returns normalized tool metadata derived from active verified contributions without exposing executable paths or credentials.",
        request: "Optional `{ output }` modality filter; omitting params lists every admitted modality.",
        response: "A bounded list of available generation tools and their public input contracts.",
      },
    }),
    defineV3Contract({
      id: "generation.execute",
      completion: "commit-preserving",
      grant: "generation.execute",
      scope: "plugin",
      sideEffect: "execute",
      errors: [...contextErrors, ...permissionErrors, ...resourceErrors, ...partialSuccessErrors],
      docs: {
        summary: "Execute one selected generation tool through the shared host executor.",
        description:
          "Revalidates the active Plugin, authorized executable, inputs, cancellation, and live resource guards immediately before execution.",
        request:
          "`{ output?, prompt, references?: Array<{ inputKey, role }>, resultMode?, toolId? }`; every opaque input key must come from the current owning node's canvas.inputs.list result.",
        response:
          "The bounded selected tool result, created node ids, optional committed operation receipt/projection, and warnings.",
      },
    }),
    defineV2Contract({
      id: "projects.list",
      completion: "cancelable",
      audience: ["web-plugin", "companion"],
      grant: "projects.read",
      scope: "plugin",
      sideEffect: "read",
      errors: permissionErrors,
      docs: {
        summary: "List Projects visible to the installed Plugin principal.",
        description:
          "Returns portable Project identities and display metadata without native paths or private Project state.",
        request: "No parameters.",
        response: "A bounded list of renderer-safe Project summaries.",
      },
    }),
    defineV3Contract({
      id: "canvas.catalog.list",
      completion: "cancelable",
      audience: ["web-plugin", "companion"],
      grant: "canvas.catalog.read",
      scope: "project",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "List Canvas catalog entries for one authorized Project.",
        description: "Reads the Project-owned Canvas catalog without selecting a Project or Canvas in the Workbench.",
        request: "`{ projectId }`, naming one explicit portable Project.",
        response: "A bounded list of portable Canvas catalog entries.",
      },
    }),
    defineV3Contract({
      id: "canvas.document.get",
      completion: "cancelable",
      audience: ["web-plugin", "companion"],
      grant: "canvas.document.read",
      scope: "canvas",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Read one authorized Canvas document projection.",
        description:
          "Returns a bounded portable structure or geometry projection from Main's authoritative Canvas application service.",
        request: "`{ ref, projection }`, using an explicit portable Project/Canvas reference and supported projection.",
        response: "The requested pathless document projection.",
      },
    }),
    defineV3Contract({
      id: "canvas.nodes.query",
      completion: "cancelable",
      audience: ["web-plugin", "companion"],
      grant: "canvas.document.read",
      scope: "canvas",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Query bounded node projections in one authorized Canvas.",
        description: "Executes a host-defined bounded query without exposing native paths or resource bytes.",
        request: "`{ ref, query }`, using an explicit portable Project/Canvas reference and bounded query.",
        response: "Matching node summaries and the current pathless Canvas projection.",
      },
    }),
    defineV3Contract({
      id: "canvas.transaction.execute",
      completion: "commit-preserving",
      audience: ["web-plugin", "companion"],
      grant: "canvas.document.write",
      scope: "canvas",
      sideEffect: "write",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Commit one closed Canvas command through the authoritative application service.",
        description:
          "Maps one bounded command to a Canvas-owned semantic intent, commits it atomically, and returns its durable operation identity.",
        request: "`{ ref, command, commandId }` with one bounded closed command and an idempotency key.",
        response: "The durable operation receipt, current pathless projection, and bounded command result.",
      },
    }),
    defineV2Contract({
      id: "canvas.events.subscribe",
      completion: "cancelable",
      audience: ["web-plugin", "companion"],
      grant: "canvas.events.subscribe",
      scope: "canvas",
      sideEffect: "subscribe",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Subscribe to bounded events for one authorized Canvas.",
        description:
          "Creates a connection-scoped subscription; events carry operation receipts as invalidations or safe projections, never native data.",
        request: "`{ ref }`, using an explicit portable Project/Canvas reference.",
        response: "A connection-bound subscription identifier.",
      },
    }),
    defineV2Contract({
      id: "canvas.events.unsubscribe",
      completion: "cancelable",
      audience: ["web-plugin", "companion"],
      grant: "canvas.events.subscribe",
      scope: "canvas",
      sideEffect: "subscribe",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Close one connection-bound Canvas event subscription.",
        description: "Releases a subscription created by canvas.events.subscribe without changing Canvas state.",
        request: "The subscription identifier returned by canvas.events.subscribe.",
        response: "An acknowledgement; closing an already closed subscription is idempotent.",
      },
    }),
  ]),
  definePluginApiRelease("2.0.0", [
    defineV2Contract({
      id: "canvas.inputs.image.open",
      completion: "cancelable",
      grant: "canvas.connectedImages.read",
      scope: "own-node",
      sideEffect: "read",
      errors: [...contextErrors, ...permissionErrors, ...resourceErrors],
      docs: {
        summary: "Open one directly connected image through the owning Plugin node.",
        description:
          "Issues a revocable Host-owned session for signature-validated JPEG, PNG, or WebP content after validating the Plugin principal, owning node, direct edge, resource identity, and image limits. Every protocol read revalidates the issued principal and direct edge against current Host state.",
        request: "`{ inputKey }`, using an opaque image key returned by canvas.inputs.list.",
        response:
          "A connection-issued, revocable session with an opaque 128-bit bearer URL, bounded image probe, and lowercase SHA-256 content revision.",
        remarks:
          "Electron protocol GET/HEAD requests have no trusted sender or frame principal. Possession of the convax-connected-media URL therefore carries bearer authority until the Host revokes the session or its principal/edge revalidation fails; the URL must be kept secret and closed promptly. The response contains no image bytes, native path, or unrestricted URL. The Host rejects images above 16 MiB, dimensions above 8192 pixels, or more than 33,554,432 pixels.",
      },
    }),
    defineV2Contract({
      id: "canvas.inputs.image.close",
      completion: "cancelable",
      grant: "canvas.connectedImages.read",
      scope: "own-node",
      sideEffect: "write",
      errors: [...contextErrors, ...permissionErrors],
      docs: {
        summary: "Close one revocable connected-image bearer session.",
        description:
          "Revokes a session and bearer URL created by canvas.inputs.image.open after validating the calling Plugin principal, without changing Canvas or Project state.",
        request: "`{ sessionId }`, using the opaque handle returned by canvas.inputs.image.open.",
        response: "An acknowledgement that the caller's image session is closed; repeated close calls are idempotent.",
      },
    }),
  ]),
  definePluginApiRelease("3.0.0", []),
)

type CatalogPluginApiId = (typeof pluginApiCatalog.apis)[number]["id"]
type CatalogContractIdsMatch = [
  Exclude<PluginApiContractId, CatalogPluginApiId>,
  Exclude<CatalogPluginApiId, PluginApiContractId>,
] extends [never, never]
  ? true
  : never
const catalogContractIdsMatch: CatalogContractIdsMatch = true
void catalogContractIdsMatch

const catalogIds = pluginApiCatalog.apis.map(({ id }) => id).sort()
if (
  catalogIds.length !== pluginApiContractIds.length ||
  catalogIds.some((id, index) => id !== pluginApiContractIds[index])
) {
  throw new TypeError("Plugin API Catalog and portable method contracts are incomplete or inconsistent")
}

export type PluginApiId = PluginApiContractId

export const PLUGIN_API_CATALOG_VERSION = pluginApiCatalog.version
export const PLUGIN_API_CATALOG_MAJOR = Number(PLUGIN_API_CATALOG_VERSION.split(".")[0])

const pluginApiDefinitionsById = new Map(pluginApiCatalog.apis.map((definition) => [definition.id, definition]))
const pluginApiIds: ReadonlySet<string> = new Set(pluginApiDefinitionsById.keys())

/**
 * Returns true when an untrusted value is a stable id in the current Host API catalog.
 *
 * @public
 */
export function isPluginApiId(value: unknown): value is PluginApiId {
  return typeof value === "string" && pluginApiIds.has(value)
}

/**
 * Returns the immutable definition for one stable Host API id.
 *
 * @public
 */
export function getPluginApiDefinition(id: PluginApiId): (typeof pluginApiCatalog.apis)[number] {
  return pluginApiDefinitionsById.get(id)!
}

/** Returns whether cancellation must preserve delivery of an already committed result. */
export function isPluginApiCommitPreserving(id: PluginApiId): boolean {
  return getPluginApiDefinition(id).completion === "commit-preserving"
}
