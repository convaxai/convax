import type {
  PluginApiCall,
  PluginApiContractId,
  PluginApiJsonValue,
  PluginApiMethodMap,
  PluginApiParams,
  PluginApiResult,
} from "./method-schemas"

/**
 * Readable public aliases projected from the one portable schema descriptor.
 * No wire shape is independently declared in this module.
 */
export type PluginApiHostContextResult = PluginApiResult<"host.context.get">
export type PluginApiHostLocaleResult = PluginApiResult<"host.locale.get">
export type PluginApiHostNode = PluginApiResult<"canvas.node.get">
export type PluginApiConnectedInput = PluginApiResult<"canvas.inputs.list">["inputs"][number]
/**
 * A revocable Host session whose URL is a bearer capability. Electron protocol
 * GET/HEAD requests do not carry a trusted sender/frame principal, so the Host
 * combines an opaque 128-bit token with revalidation of the issued Plugin
 * principal and direct Canvas edge before each read.
 */
export type PluginApiConnectedImageOpenResult = PluginApiResult<"canvas.inputs.image.open">
export type PluginApiConnectedImageProbe = PluginApiConnectedImageOpenResult["probe"]
export type PluginApiConnectedMediaOpenResult = PluginApiResult<"canvas.inputs.open">
export type PluginApiConnectedMediaProbe = PluginApiConnectedMediaOpenResult["probe"]
export type PluginApiGenerationReference = NonNullable<PluginApiParams<"generation.execute">["references"]>[number]
export type PluginApiGenerationToolSummary = PluginApiResult<"generation.tools.list">["tools"][number]
export type PluginApiGenerationResult = PluginApiResult<"generation.execute">
export type PluginApiProjectSummary = PluginApiResult<"projects.list">["projects"][number]
export type PluginApiCanvasSummary = PluginApiResult<"canvas.catalog.list">["canvases"][number]
export type PluginApiCanvasDocumentResult = PluginApiResult<"canvas.document.get">
export type PluginApiCanvasGeometryDocument = Extract<
  PluginApiCanvasDocumentResult,
  { readonly projection: "geometry" }
>["document"]
export type PluginApiCanvasStructureDocument = Extract<
  PluginApiCanvasDocumentResult,
  { readonly projection: "structure" }
>["document"]
export type PluginApiCanvasGeometryNode = PluginApiCanvasGeometryDocument["nodes"][number]
export type PluginApiCanvasStructureNode = PluginApiCanvasStructureDocument["nodes"][number]
export type PluginApiCanvasNodeQuery = NonNullable<PluginApiParams<"canvas.nodes.query">["query"]>
export type PluginApiCanvasNodeQueryResult = PluginApiResult<"canvas.nodes.query">
export type PluginApiCanvasNodeSummary = PluginApiCanvasNodeQueryResult["nodes"][number]
export type PluginApiCanvasTransactionRequest = PluginApiParams<"canvas.transaction.execute">
export type PluginApiCanvasTransactionCommand = PluginApiCanvasTransactionRequest["command"]
export type PluginApiCanvasTransactionResult = PluginApiResult<"canvas.transaction.execute">
export type PluginApiCanvasRef = PluginApiParams<"canvas.document.get">["ref"]
export type PluginApiPoint = PluginApiCanvasGeometryNode["position"]
export type PluginApiSize = PluginApiCanvasGeometryNode["size"]
export type PluginApiGenerationModality = NonNullable<NonNullable<PluginApiParams<"generation.tools.list">>["output"]>
export type PluginApiGenerationInputRole = PluginApiGenerationToolSummary["acceptedInputs"][number]
export type PluginApiGenerationResultMode = NonNullable<PluginApiParams<"generation.execute">["resultMode"]>

export type {
  PluginApiCall,
  PluginApiContractId,
  PluginApiJsonValue,
  PluginApiMethodMap,
  PluginApiParams,
  PluginApiResult,
}
