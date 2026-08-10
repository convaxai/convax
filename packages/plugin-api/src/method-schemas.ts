export type PluginApiStringRefinement =
  | "lowercase-sha256"
  | "portable-project-relative-path"
  | "safe-png-file-name"
  | "trimmed"

export interface PluginApiWireProductConstraint<Field extends string = string> {
  readonly fields: readonly [Field, Field, ...Field[]]
  readonly maximum: number
}

export type PluginApiWireSchema =
  | { readonly type: "none" }
  | { readonly type: "boolean" }
  | { readonly const: boolean | number | string }
  | {
      readonly type: "integer" | "number"
      readonly finite: true
      readonly maximum?: number
      readonly minimum?: number
    }
  | {
      readonly type: "string"
      readonly controlCharacters: false
      readonly enum?: readonly string[]
      readonly maxLength: number
      readonly minLength: number
      readonly prefix?: string
      readonly refinement?: PluginApiStringRefinement
    }
  | {
      readonly type: "array"
      readonly items: PluginApiWireSchema
      readonly maxItems: number
      readonly minItems: number
      readonly uniqueBy?: string
    }
  | {
      readonly additionalProperties: false
      readonly properties: Readonly<Record<string, PluginApiWireSchema>>
      readonly products?: readonly PluginApiWireProductConstraint[]
      readonly required: readonly string[]
      readonly type: "object"
    }
  | {
      readonly keyMaxLength: number
      readonly maxBytes: number
      readonly maxDepth: number
      readonly type: "json-object"
    }
  | {
      readonly oneOf: readonly PluginApiWireSchema[]
    }
  | {
      readonly type: "null"
    }

export interface PluginApiWireLimit {
  readonly maxBytes: number
  readonly schema: PluginApiWireSchema
}

export interface PluginApiWireContract {
  readonly dialect: PluginApiWireSchemaDialect
  readonly request: PluginApiWireLimit
  readonly result: PluginApiWireLimit
}

/** Wire-schema semantics admitted by the current runtime and generated Catalog. */
export const pluginApiWireSchemaDialect = "convax.plugin-api-wire-schema/3" as const

export type PluginApiWireSchemaDialect = typeof pluginApiWireSchemaDialect

declare const pluginApiSchemaValue: unique symbol
interface PluginApiSchemaBrand<Value> {
  readonly [pluginApiSchemaValue]: Value
}

export type PluginApiJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PluginApiJsonValue[]
  | { readonly [key: string]: PluginApiJsonValue }

const KiB = 1024
const MiB = KiB * KiB
export const maximumPluginApiConnectedImageBytes = 16 * MiB
export const maximumPluginApiConnectedImageDimension = 8_192
export const maximumPluginApiConnectedImagePixels = 33_554_432
const none = { type: "none" } as const as { readonly type: "none" } & PluginApiSchemaBrand<undefined>
const bool = { type: "boolean" } as const as { readonly type: "boolean" } & PluginApiSchemaBrand<boolean>
const finite = { finite: true, type: "number" } as const as {
  readonly finite: true
  readonly type: "number"
} & PluginApiSchemaBrand<number>
const integer = { finite: true, minimum: 0, type: "integer" } as const as {
  readonly finite: true
  readonly minimum: 0
  readonly type: "integer"
} & PluginApiSchemaBrand<number>
const boundedPositiveInteger = <const Maximum extends number>(maximum: Maximum) =>
  ({ finite: true, maximum, minimum: 1, type: "integer" }) as {
    readonly finite: true
    readonly maximum: Maximum
    readonly minimum: 1
    readonly type: "integer"
  } & PluginApiSchemaBrand<number>
const nil = { type: "null" } as const as { readonly type: "null" } & PluginApiSchemaBrand<null>
const literal = <const Value extends boolean | number | string>(value: Value) =>
  ({ const: value }) as { readonly const: Value } & PluginApiSchemaBrand<Value>
const string = (
  maxLength = 2_048,
  options: {
    readonly allowEmpty?: boolean
    readonly prefix?: string
    readonly refinement?: PluginApiStringRefinement
  } = {},
): {
  readonly controlCharacters: false
  readonly maxLength: number
  readonly minLength: number
  readonly prefix?: string
  readonly refinement?: PluginApiStringRefinement
  readonly type: "string"
} & PluginApiSchemaBrand<string> =>
  ({
    controlCharacters: false,
    maxLength,
    minLength: options.allowEmpty ? 0 : 1,
    ...(options.prefix ? { prefix: options.prefix } : {}),
    ...(options.refinement ? { refinement: options.refinement } : {}),
    type: "string",
  }) as {
    readonly controlCharacters: false
    readonly maxLength: number
    readonly minLength: number
    readonly prefix?: string
    readonly refinement?: PluginApiStringRefinement
    readonly type: "string"
  } & PluginApiSchemaBrand<string>
const array = <const Items extends PluginApiWireSchema>(
  items: Items,
  maxItems: number,
  minItems = 0,
  uniqueBy?: string,
): {
  readonly items: Items
  readonly maxItems: number
  readonly minItems: number
  readonly type: "array"
  readonly uniqueBy?: string
} & PluginApiSchemaBrand<readonly PluginApiSchemaValue<Items>[]> =>
  ({ items, maxItems, minItems, type: "array", ...(uniqueBy ? { uniqueBy } : {}) }) as {
    readonly items: Items
    readonly maxItems: number
    readonly minItems: number
    readonly type: "array"
    readonly uniqueBy?: string
  } & PluginApiSchemaBrand<readonly PluginApiSchemaValue<Items>[]>
const object = <
  const Properties extends Readonly<Record<string, PluginApiWireSchema>>,
  const Required extends readonly (keyof Properties & string)[],
  const Products extends readonly PluginApiWireProductConstraint<keyof Properties & string>[] | undefined = undefined,
>(
  properties: Properties,
  required: Required,
  products?: Products,
): {
  readonly additionalProperties: false
  readonly properties: Properties
  readonly products?: Products
  readonly required: Required
  readonly type: "object"
} & PluginApiSchemaBrand<
  {
    readonly [Key in RequiredPropertyKeys<Properties, Required>]-?: PluginApiSchemaValue<Properties[Key]>
  } & {
    readonly [Key in Exclude<keyof Properties, RequiredPropertyKeys<Properties, Required>>]?: PluginApiSchemaValue<
      Properties[Key]
    >
  }
> =>
  ({
    additionalProperties: false,
    properties,
    ...(products ? { products } : {}),
    required,
    type: "object",
  }) as {
    readonly additionalProperties: false
    readonly properties: Properties
    readonly products?: Products
    readonly required: Required
    readonly type: "object"
  } & PluginApiSchemaBrand<
    {
      readonly [Key in RequiredPropertyKeys<Properties, Required>]-?: PluginApiSchemaValue<Properties[Key]>
    } & {
      readonly [Key in Exclude<keyof Properties, RequiredPropertyKeys<Properties, Required>>]?: PluginApiSchemaValue<
        Properties[Key]
      >
    }
  >
const union = <const Schemas extends readonly PluginApiWireSchema[]>(
  ...oneOf: Schemas
): { readonly oneOf: Schemas } & PluginApiSchemaBrand<PluginApiSchemaValue<Schemas[number]>> =>
  ({ oneOf }) as { readonly oneOf: Schemas } & PluginApiSchemaBrand<PluginApiSchemaValue<Schemas[number]>>
const jsonObject = (maxBytes = MiB) =>
  ({ keyMaxLength: 128, maxBytes, maxDepth: 32, type: "json-object" }) as {
    readonly keyMaxLength: 128
    readonly maxBytes: number
    readonly maxDepth: 32
    readonly type: "json-object"
  } & PluginApiSchemaBrand<Readonly<Record<string, PluginApiJsonValue>>>
const enumString = <const Values extends readonly string[]>(values: Values) =>
  ({
    controlCharacters: false,
    enum: values,
    maxLength: Math.max(...values.map((value) => value.length)),
    minLength: 1,
    type: "string",
  }) as {
    readonly controlCharacters: false
    readonly enum: Values
    readonly maxLength: number
    readonly minLength: 1
    readonly type: "string"
  } & PluginApiSchemaBrand<Values[number]>

const point = object({ x: finite, y: finite }, ["x", "y"])
const size = object({ height: finite, width: finite }, ["height", "width"])
const canvasRef = object({ canvasId: string(256), projectId: string(256) }, ["canvasId", "projectId"])
const modality = enumString(["text", "image", "video", "audio"])
const inputRole = enumString(["text", "reference_image", "reference_video", "first_frame", "last_frame", "audio"])
const stringList = (maximum = 1_000) => array(string(), maximum)

const availability = union(
  object(
    {
      available: literal(true),
      catalogVersion: string(64),
      contractSince: string(64),
      id: string(128),
      since: string(64),
    },
    ["available", "catalogVersion", "contractSince", "id", "since"],
  ),
  object(
    {
      available: literal(false),
      contractSince: string(64),
      id: string(128),
      reason: enumString([
        "unsupported-host",
        "not-declared",
        "permission-denied",
        "wrong-surface",
        "missing-context",
        "setup-required",
        "disabled",
        "recovering",
      ]),
      recoverable: bool,
      since: string(64),
    },
    ["available", "id", "reason", "recoverable"],
  ),
)

const hostNode = object(
  {
    data: jsonObject(),
    id: string(),
    parentId: string(),
    position: point,
    style: jsonObject(),
    type: string(80),
  },
  ["data", "id", "position", "type"],
)

const generationReference = object({ inputKey: string(), role: inputRole }, ["inputKey", "role"])
const nodeQuery = object(
  {
    ids: stringList(),
    kinds: stringList(),
    limit: integer,
    relatedToNodeIds: stringList(),
    text: string(2_000, { allowEmpty: true }),
  },
  [],
)

const connection = object(
  {
    animated: bool,
    id: string(),
    source: string(),
    target: string(),
    type: string(80),
  },
  ["source", "target"],
)
const geometryUpdate = object({ nodeId: string(), position: point, size }, ["nodeId", "position"])
const autoLayoutOptions = object(
  {
    componentGap: finite,
    componentPackingScale: finite,
    crossGap: finite,
    isolatedPlacement: enumString(["left", "preserve"]),
    mainGap: finite,
    nodeGap: finite,
    nodePackingScale: finite,
    strategy: enumString(["component-packing", "horizontal-directed-cluster", "vertical-directed-cluster"]),
  },
  [],
)
const transactionCommand = union(
  object({ edgeIds: stringList(), nodeIds: stringList(), type: literal("elements.remove") }, ["type"]),
  object(
    {
      direction: enumString(["left", "center", "right", "top", "middle", "bottom"]),
      nodeIds: stringList(),
      type: literal("nodes.align"),
    },
    ["direction", "nodeIds", "type"],
  ),
  object({ connection, type: literal("nodes.connect") }, ["connection", "type"]),
  object(
    {
      axis: enumString(["horizontal", "vertical"]),
      nodeIds: stringList(),
      type: literal("nodes.distribute"),
    },
    ["axis", "nodeIds", "type"],
  ),
  object({ label: string(512), nodeIds: stringList(), type: literal("nodes.group") }, ["nodeIds", "type"]),
  object(
    {
      gap: finite,
      layout: enumString(["grid", "horizontal", "vertical"]),
      nodeIds: stringList(),
      type: literal("nodes.layout"),
    },
    ["nodeIds", "type"],
  ),
  object({ delta: point, nodeIds: stringList(), type: literal("nodes.move") }, ["delta", "nodeIds", "type"]),
  object({ type: literal("nodes.setGeometry"), updates: array(geometryUpdate, 1_000) }, ["type", "updates"]),
  object({ nodeId: string(), type: literal("nodes.ungroup") }, ["nodeId", "type"]),
  object({ nodeIds: stringList(), options: autoLayoutOptions, type: literal("canvas.auto-layout") }, ["type"]),
)

const connectedInput = object(
  {
    durationMs: finite,
    height: finite,
    inputKey: string(),
    kind: string(80),
    label: string(512),
    mediaRevision: string(512),
    mimeType: string(512),
    name: string(512),
    status: enumString(["error", "idle", "pending"]),
    width: finite,
  },
  ["inputKey", "kind", "label"],
)

const connectedImageProbe = object(
  {
    contentRevision: string(64, { refinement: "lowercase-sha256" }),
    height: boundedPositiveInteger(maximumPluginApiConnectedImageDimension),
    kind: literal("image"),
    mimeType: enumString(["image/jpeg", "image/png", "image/webp"]),
    size: boundedPositiveInteger(maximumPluginApiConnectedImageBytes),
    width: boundedPositiveInteger(maximumPluginApiConnectedImageDimension),
  },
  ["contentRevision", "height", "kind", "mimeType", "size", "width"],
  [{ fields: ["width", "height"], maximum: maximumPluginApiConnectedImagePixels }],
)

const generationTool = object(
  {
    acceptedInputs: array(inputRole, 6),
    description: string(2_000),
    id: string(256),
    kind: enumString(["model", "operation"]),
    output: modality,
    title: string(120),
  },
  ["acceptedInputs", "description", "id", "kind", "output", "title"],
)

const edge = object({ id: string(), source: string(), target: string() }, ["id", "source", "target"])
const geometryNode = object(
  {
    id: string(),
    kind: string(80),
    label: string(512),
    parentId: string(64 * KiB, { allowEmpty: true }),
    position: point,
    size,
    type: string(64 * KiB, { allowEmpty: true }),
  },
  ["id", "kind", "label", "position", "size"],
)
const structureNode = object(
  {
    description: string(64 * KiB, { allowEmpty: true }),
    durationMs: finite,
    id: string(),
    kind: string(80),
    label: string(512),
    mimeType: string(64 * KiB, { allowEmpty: true }),
    name: string(64 * KiB, { allowEmpty: true }),
    parentId: string(64 * KiB, { allowEmpty: true }),
    position: point,
    resource: object({ kind: literal("project-file"), path: string(1_024) }, ["kind", "path"]),
    size,
    status: string(64 * KiB, { allowEmpty: true }),
    text: string(64 * KiB, { allowEmpty: true }),
    type: string(64 * KiB, { allowEmpty: true }),
  },
  ["id", "kind", "label", "position", "size"],
)
const geometryDocument = object(
  {
    edges: array(edge, 10_000),
    id: string(256),
    nodes: array(geometryNode, 10_000),
    title: string(512),
  },
  ["edges", "id", "nodes", "title"],
)
const structureDocument = object(
  {
    description: string(8_000, { allowEmpty: true }),
    edges: array(edge, 10_000),
    id: string(256),
    nodes: array(structureNode, 10_000),
    tags: array(string(), 256),
    title: string(512),
  },
  ["edges", "id", "nodes", "title"],
)
const operationReceipt = object(
  {
    actorId: string(43),
    baseFrontierDigest: string(64, { refinement: "lowercase-sha256" }),
    format: literal("convax.canvas-operation-receipt/2"),
    historyMaterialDigest: union(nil, string(64, { refinement: "lowercase-sha256" })),
    intentDigest: string(64, { refinement: "lowercase-sha256" }),
    intentKind: string(256),
    operationId: string(22),
    resultEntities: array(
      object(
        {
          id: string(256),
          incarnation: string(256),
          kind: enumString(["node", "edge"]),
        },
        ["id", "incarnation", "kind"],
      ),
      10_000,
    ),
    semanticRoot: bool,
  },
  [
    "actorId",
    "baseFrontierDigest",
    "format",
    "historyMaterialDigest",
    "intentDigest",
    "intentKind",
    "operationId",
    "resultEntities",
    "semanticRoot",
  ],
)
const nodeSummary = object(
  {
    id: string(),
    incomingNodeIds: stringList(),
    kind: string(80),
    label: string(512),
    outgoingNodeIds: stringList(),
    parentId: string(64 * KiB, { allowEmpty: true }),
    position: point,
    text: string(64 * KiB, { allowEmpty: true }),
    type: string(64 * KiB, { allowEmpty: true }),
  },
  ["id", "incomingNodeIds", "kind", "label", "outgoingNodeIds", "position"],
)

const hostContextResult = object(
  {
    canvas: object({ id: string(256), name: string(512) }, ["id"]),
    hostApi: object({ availability: array(availability, 256, 0, "id"), catalogVersion: string(64) }, [
      "availability",
      "catalogVersion",
    ]),
    node: hostNode,
    plugin: object({ id: string(128), name: string(512), version: string(128) }, ["id", "name", "version"]),
    project: object({ id: string(256), name: string(512) }, ["id"]),
  },
  ["canvas", "hostApi", "node", "plugin", "project"],
)

const hostLocaleResult = object({ locale: string(35, { refinement: "trimmed" }) }, ["locale"])

const contract = <const Request extends PluginApiWireSchema, const Result extends PluginApiWireSchema>(
  request: Request,
  result: Result,
  limits: { readonly request?: number; readonly result?: number } = {},
): {
  readonly dialect: typeof pluginApiWireSchemaDialect
  readonly request: { readonly maxBytes: number; readonly schema: Request }
  readonly result: { readonly maxBytes: number; readonly schema: Result }
} => ({
  dialect: pluginApiWireSchemaDialect,
  request: { maxBytes: limits.request ?? 64 * KiB, schema: request },
  result: { maxBytes: limits.result ?? 64 * KiB, schema: result },
})

/**
 * Complete portable wire schemas and byte budgets for every Host API.
 *
 * These values are serialized into the generated Catalog and immutable history.
 * Runtime parsers in `method-contracts.ts` enforce the same closed contract.
 */
export const pluginApiWireContracts = Object.freeze({
  "host.context.get": contract(none, hostContextResult, { result: MiB }),
  "host.locale.get": contract(none, hostLocaleResult),
  "canvas.inputs.list": contract(none, object({ inputs: array(connectedInput, 256) }, ["inputs"]), {
    result: MiB,
  }),
  "canvas.inputs.image.open": contract(
    object({ inputKey: string() }, ["inputKey"]),
    object(
      {
        probe: connectedImageProbe,
        sessionId: string(128),
        url: string(2_048, { prefix: "convax-connected-media://" }),
      },
      ["probe", "sessionId", "url"],
    ),
  ),
  "canvas.inputs.image.close": contract(
    object({ sessionId: string(128) }, ["sessionId"]),
    object({ closed: bool }, ["closed"]),
  ),
  "canvas.inputs.open": contract(
    object({ inputKey: string() }, ["inputKey"]),
    object(
      {
        probe: object(
          {
            duration: object({ estimated: bool, milliseconds: finite }, ["estimated", "milliseconds"]),
            height: finite,
            kind: enumString(["audio", "video"]),
            mediaRevision: string(128),
            mimeType: string(256),
            size: finite,
            width: finite,
          },
          ["duration", "kind", "mediaRevision", "mimeType", "size"],
        ),
        sessionId: string(128),
        url: string(2_048, { prefix: "convax-connected-media://" }),
      },
      ["probe", "sessionId", "url"],
    ),
  ),
  "canvas.inputs.close": contract(
    object({ sessionId: string(128) }, ["sessionId"]),
    object({ closed: bool }, ["closed"]),
  ),
  "canvas.node.get": contract(none, hostNode, { result: MiB }),
  "canvas.node.state.replace": contract(
    object({ state: jsonObject(256 * KiB) }, ["state"]),
    object({ operationReceipt, projection: hostNode, updated: literal(true) }, [
      "operationReceipt",
      "projection",
      "updated",
    ]),
    { request: 256 * KiB + 4 * KiB },
  ),
  "canvas.resource.image.create": contract(
    object(
      {
        dataUrl: string(24 * MiB, { prefix: "data:image/png;base64," }),
        name: string(120, { refinement: "safe-png-file-name" }),
      },
      ["dataUrl", "name"],
    ),
    object({ createdNodeId: string(), operationReceipt, projection: structureDocument }, [
      "createdNodeId",
      "operationReceipt",
      "projection",
    ]),
    { request: 24 * MiB + 4 * KiB },
  ),
  "project.file.text.read": contract(
    object({ path: string(1_024, { refinement: "portable-project-relative-path" }) }, ["path"]),
    object(
      {
        content: string(MiB, { allowEmpty: true }),
        exists: bool,
        path: string(1_024, { refinement: "portable-project-relative-path" }),
      },
      ["content", "exists", "path"],
    ),
    { result: MiB + 4 * KiB },
  ),
  "agent.prompt": contract(
    object({ text: string(20_000, { refinement: "trimmed" }) }, ["text"]),
    object({ text: string(64 * KiB, { allowEmpty: true }) }, ["text"]),
  ),
  "generation.tools.list": contract(
    union(none, object({ output: modality }, [])),
    object({ tools: array(generationTool, 256) }, ["tools"]),
    { result: MiB },
  ),
  "generation.execute": contract(
    object(
      {
        output: modality,
        prompt: string(20_000, { refinement: "trimmed" }),
        references: array(generationReference, 32),
        resultMode: enumString(["create-pending-node", "return"]),
        toolId: string(256),
      },
      ["prompt"],
    ),
    object(
      {
        createdNodeIds: array(string(), 32),
        outputText: string(64 * KiB, { allowEmpty: true }),
        operationReceipt: union(nil, operationReceipt),
        projection: union(nil, structureDocument),
        toolId: string(256),
        warnings: array(string(), 32),
      },
      ["createdNodeIds", "operationReceipt", "projection", "toolId", "warnings"],
    ),
    { result: 256 * KiB },
  ),
  "projects.list": contract(
    none,
    object(
      {
        projects: array(
          object({ available: bool, id: string(256), name: string(512) }, ["available", "id", "name"]),
          1_000,
        ),
      },
      ["projects"],
    ),
    { result: MiB },
  ),
  "canvas.catalog.list": contract(
    object({ projectId: string(256) }, ["projectId"]),
    object(
      {
        canvases: array(object({ id: string(256), name: string(512) }, ["id", "name"]), 10_000),
        projectId: string(256),
      },
      ["canvases", "projectId"],
    ),
    { result: 8 * MiB },
  ),
  "canvas.document.get": contract(
    object({ projection: enumString(["geometry", "structure"]), ref: canvasRef }, ["ref"]),
    union(
      object(
        {
          document: geometryDocument,
          projection: literal("geometry"),
          ref: canvasRef,
        },
        ["document", "projection", "ref"],
      ),
      object(
        {
          document: structureDocument,
          projection: literal("structure"),
          ref: canvasRef,
        },
        ["document", "projection", "ref"],
      ),
    ),
    { result: 8 * MiB },
  ),
  "canvas.nodes.query": contract(
    object({ query: nodeQuery, ref: canvasRef }, ["ref"]),
    object(
      {
        nodes: array(nodeSummary, 1_000),
        projection: structureDocument,
        ref: canvasRef,
      },
      ["nodes", "projection", "ref"],
    ),
    { request: MiB, result: 8 * MiB },
  ),
  "canvas.transaction.execute": contract(
    object(
      {
        command: transactionCommand,
        commandId: string(128),
        ref: canvasRef,
      },
      ["command", "commandId", "ref"],
    ),
    object(
      {
        affectedNodeIds: stringList(10_000),
        changed: bool,
        createdNodeIds: stringList(10_000),
        operationReceipt,
        projection: structureDocument,
        ref: canvasRef,
        summaryTruncated: bool,
        warnings: stringList(),
      },
      ["affectedNodeIds", "changed", "createdNodeIds", "operationReceipt", "projection", "ref", "warnings"],
    ),
    { request: MiB, result: 2 * MiB },
  ),
  "canvas.events.subscribe": contract(
    object({ ref: object({ canvasId: string(256), projectId: string(256) }, ["projectId"]) }, ["ref"]),
    object({ subscriptionId: string(128) }, ["subscriptionId"]),
  ),
  "canvas.events.unsubscribe": contract(
    object({ subscriptionId: string(128) }, ["subscriptionId"]),
    object({ removed: bool }, ["removed"]),
  ),
} as const satisfies Readonly<Record<string, PluginApiWireContract>>)

export type PluginApiContractId = keyof typeof pluginApiWireContracts

type RequiredPropertyKeys<Properties extends Readonly<Record<string, PluginApiWireSchema>>, Required> = Extract<
  Required extends readonly string[] ? Required[number] : never,
  keyof Properties
>

/** Static TypeScript projection of the exact portable runtime schema dialect. */
export type PluginApiSchemaValue<Schema extends PluginApiWireSchema> =
  Schema extends PluginApiSchemaBrand<infer Value> ? Value : never

type PluginApiParamsFor<Id extends PluginApiContractId> = PluginApiSchemaValue<
  (typeof pluginApiWireContracts)[Id]["request"]["schema"]
>

type PluginApiResultFor<Id extends PluginApiContractId> = PluginApiSchemaValue<
  (typeof pluginApiWireContracts)[Id]["result"]["schema"]
>

export type PluginApiMethodMap = {
  readonly [Id in PluginApiContractId]: {
    readonly params: PluginApiParamsFor<Id>
    readonly result: PluginApiResultFor<Id>
  }
}

export type PluginApiParams<Id extends PluginApiContractId> = PluginApiMethodMap[Id]["params"]
export type PluginApiResult<Id extends PluginApiContractId> = PluginApiMethodMap[Id]["result"]

export type PluginApiCall<Id extends PluginApiContractId = PluginApiContractId> = {
  readonly [Method in Id]: PluginApiParams<Method> extends undefined
    ? { readonly method: Method; readonly params?: never }
    : undefined extends PluginApiParams<Method>
      ? {
          readonly method: Method
          readonly params?: Exclude<PluginApiParams<Method>, undefined>
        }
      : { readonly method: Method; readonly params: PluginApiParams<Method> }
}[Id]

export const maximumPluginApiRequestBytes = Math.max(
  ...Object.values(pluginApiWireContracts).map(({ request }) => request.maxBytes),
)
export const maximumPluginApiResultBytes = Math.max(
  ...Object.values(pluginApiWireContracts).map(({ result }) => result.maxBytes),
)

export function getPluginApiWireContract<Id extends PluginApiContractId>(id: Id): (typeof pluginApiWireContracts)[Id] {
  return pluginApiWireContracts[id]
}
