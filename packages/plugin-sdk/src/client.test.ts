import { describe, expect, mock, test } from "bun:test"
import { PluginApiUnavailableError, type ApiAvailability } from "@convax/plugin-api"

import { parsePluginManifestV8 } from "./manifest"
import {
  assertPluginHostMessageByteLength,
  createPluginHostClient,
  isPluginHostCancel,
  isPluginHostCapabilityAvailabilityRequest,
  isPluginHostCapabilityInvokeRequest,
  isPluginHostCommand,
  isPluginHostConnect,
  isPluginHostDisconnect,
  isPluginHostLocaleChangedCommand,
  isPluginHostRequest,
  isPluginHostResponse,
  maximumPluginHostInFlightRequests,
  pluginHostProtocolV8,
  PluginHostAbortError,
  PluginHostProtocolError,
  PluginHostRemoteError,
  type PluginHostAbortSignal,
  type PluginHostDeclaredApiId,
  type PluginHostImportedCapabilityId,
  type PluginHostMessageEvent,
  type PluginHostMessagePort,
} from "./client"

const textInput = {
  additionalProperties: false,
  properties: { text: { maxLength: 32, type: "string" } },
  required: ["text"],
  type: "object",
} as const

const valueOutput = {
  additionalProperties: false,
  properties: { value: { maximum: 100, minimum: 0, type: "integer" } },
  required: ["value"],
  type: "object",
} as const

const manifest = parsePluginManifestV8({
  capabilities: ["canvas.connectedInputs.read"],
  contributes: {
    capabilities: {
      exports: [],
      imports: {
        optional: [
          {
            id: "media.inspect",
            inputSchema: textInput,
            outputSchema: valueOutput,
            version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
          },
        ],
        required: [
          {
            id: "media.transform",
            inputSchema: textInput,
            outputSchema: valueOutput,
            version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
          },
        ],
      },
    },
    canvas: { renderer: { create: true } },
  },
  description: "Client test Plugin",
  entry: "web/index.html",
  hostApi: {
    major: 3,
    optional: ["canvas.resource.image.create"],
    required: ["host.context.get", "host.locale.get"],
  },
  id: "client-test",
  name: "Client Test",
  schema: "convax.plugin/8",
  version: "1.0.0",
})

const declaredHostApi: PluginHostDeclaredApiId<typeof manifest> = "host.context.get"
const declaredImportedCapability: PluginHostImportedCapabilityId<typeof manifest> = "media.transform"
// @ts-expect-error the typed client cannot name an undeclared Host API.
const undeclaredHostApi: PluginHostDeclaredApiId<typeof manifest> = "agent.prompt"
// @ts-expect-error the typed client cannot name an undeclared inter-Plugin capability.
const undeclaredImportedCapability: PluginHostImportedCapabilityId<typeof manifest> = "media.undeclared"
void [declaredHostApi, declaredImportedCapability, undeclaredHostApi, undeclaredImportedCapability]

class FakePort implements PluginHostMessagePort {
  readonly sent: unknown[] = []
  readonly #listeners = new Set<(event: PluginHostMessageEvent) => void>()
  closeCalls = 0
  failPost = false
  started = false

  addEventListener(_type: "message", listener: (event: PluginHostMessageEvent) => void) {
    this.#listeners.add(listener)
  }

  removeEventListener(_type: "message", listener: (event: PluginHostMessageEvent) => void) {
    this.#listeners.delete(listener)
  }

  postMessage(message: unknown) {
    if (this.failPost) throw new Error("transport failed")
    this.sent.push(message)
  }

  close() {
    this.closeCalls += 1
  }

  start() {
    this.started = true
  }

  emit(data: unknown) {
    for (const listener of this.#listeners) listener({ data })
  }
}

class FakeAbortSignal implements PluginHostAbortSignal {
  aborted = false
  reason: unknown
  readonly #listeners = new Set<() => void>()

  addEventListener(_type: "abort", listener: () => void) {
    this.#listeners.add(listener)
  }

  removeEventListener(_type: "abort", listener: () => void) {
    this.#listeners.delete(listener)
  }

  abort(reason: unknown) {
    if (this.aborted) return
    this.aborted = true
    this.reason = reason
    for (const listener of this.#listeners) listener()
  }
}

function response(id: string, result: unknown) {
  return { id, ok: true, protocol: pluginHostProtocolV8, result, type: "response" }
}

function failure(
  id: string,
  error: {
    readonly code: string
    readonly kind: "api" | "capability" | "protocol"
    readonly message: string
    readonly recoverable: boolean
  },
) {
  return { error, id, ok: false, protocol: pluginHostProtocolV8, type: "response" }
}

function hostContextResult(_projectionSequence = 1, availability: readonly ApiAvailability[] = []) {
  return {
    canvas: { id: "c1" },
    hostApi: { availability, catalogVersion: "3.0.0" },
    node: {
      data: { kind: "plugin", label: "Plugin" },
      id: "n1",
      position: { x: 0, y: 0 },
      type: "file",
    },
    plugin: { id: "client-test", name: "Client Test", version: "1.0.0" },
    project: { id: "p1" },
  }
}

describe("@convax/plugin-sdk/client envelopes", () => {
  test("owns strict host/8 connect, request, response, command, capability, cancel, and disconnect shapes", () => {
    expect(
      isPluginHostConnect({
        pluginId: "client-test",
        protocol: pluginHostProtocolV8,
        type: "connect",
      }),
    ).toBeTrue()
    expect(
      isPluginHostRequest({
        id: "host-1",
        method: "host.context.get",
        protocol: pluginHostProtocolV8,
        type: "request",
      }),
    ).toBeTrue()
    expect(isPluginHostResponse(response("host-1", {}))).toBeTrue()
    expect(
      isPluginHostResponse(
        failure("host-2", {
          code: "stale-context",
          kind: "api",
          message: "Context changed.",
          recoverable: true,
        }),
      ),
    ).toBeTrue()
    expect(
      isPluginHostResponse({
        error: "legacy string",
        id: "host-3",
        ok: false,
        protocol: pluginHostProtocolV8,
        type: "response",
      }),
    ).toBeFalse()
    expect(
      isPluginHostCommand({
        command: "canvas.inputs.changed",
        protocol: pluginHostProtocolV8,
        type: "command",
      }),
    ).toBeTrue()
    expect(
      isPluginHostLocaleChangedCommand({
        command: "host.locale.changed",
        params: { locale: "zh-CN" },
        protocol: pluginHostProtocolV8,
        type: "command",
      }),
    ).toBeTrue()
    expect(
      isPluginHostLocaleChangedCommand({
        command: "host.locale.changed",
        params: { locale: "zh_CN" },
        protocol: pluginHostProtocolV8,
        type: "command",
      }),
    ).toBeFalse()
    expect(
      isPluginHostCapabilityAvailabilityRequest({
        capabilityId: "media.inspect",
        id: "availability-1",
        protocol: pluginHostProtocolV8,
        type: "capability-availability",
      }),
    ).toBeTrue()
    expect(
      isPluginHostCapabilityInvokeRequest({
        capabilityId: "media.transform",
        id: "invoke-1",
        input: { text: "hello" },
        protocol: pluginHostProtocolV8,
        type: "capability-invoke",
      }),
    ).toBeTrue()
    expect(isPluginHostCancel({ id: "invoke-1", protocol: pluginHostProtocolV8, type: "cancel" })).toBeTrue()
    expect(isPluginHostDisconnect({ protocol: pluginHostProtocolV8, type: "disconnect" })).toBeTrue()
    expect(
      isPluginHostDisconnect({
        frameId: "forbidden",
        protocol: pluginHostProtocolV8,
        type: "disconnect",
      }),
    ).toBeFalse()
    expect(
      isPluginHostCapabilityInvokeRequest({
        capabilityId: "media.transform",
        id: "invoke-1",
        input: { text: "hello" },
        protocol: pluginHostProtocolV8,
        providerPluginId: "forbidden-routing-target",
        type: "capability-invoke",
      }),
    ).toBeFalse()
  })

  test("computes the exact JSON wire size without recursive serialization", () => {
    const value = {
      control: "\n",
      negativeZero: -0,
      quote: '"',
      unicode: "画布😀",
      values: [true, false, null, 1.25],
    }
    expect(assertPluginHostMessageByteLength(value, 1024)).toBe(
      new TextEncoder().encode(JSON.stringify(value)).byteLength,
    )
  })
})

describe("createPluginHostClient", () => {
  test("keeps a newer locale event authoritative over an older in-flight read", async () => {
    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "locale" })
    const observed: string[] = []
    const genericCommands: string[] = []
    client.onLocaleChange((locale) => observed.push(locale))
    client.onCommand((command) => genericCommands.push(command.command))

    const initial = client.getLocale()
    expect(port.sent[0]).toMatchObject({ method: "host.locale.get", type: "request" })
    port.emit({
      command: "host.locale.changed",
      params: { locale: "zh-CN" },
      protocol: pluginHostProtocolV8,
      type: "command",
    })
    port.emit(response("locale-1", { locale: "en" }))

    await expect(initial).resolves.toBe("zh-CN")
    expect(observed).toEqual(["zh-CN"])
    expect(genericCommands).toEqual([])
  })

  test("fails closed when the reserved locale event shape is invalid", () => {
    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "locale-invalid" })
    port.emit({
      command: "host.locale.changed",
      params: { locale: "zh_CN" },
      protocol: pluginHostProtocolV8,
      type: "command",
    })
    expect(client.closed).toBeTrue()
  })

  test("rejects a locale event when the Plugin did not declare locale access", () => {
    const port = new FakePort()
    const client = createPluginHostClient({
      manifest: {
        ...manifest,
        hostApi: { ...manifest.hostApi, required: ["host.context.get"] },
      },
      port,
      requestIdPrefix: "locale-undeclared",
    })
    expect(() => client.onLocaleChange(() => undefined)).toThrow("Plugin Host API is not declared")
    port.emit({
      command: "host.locale.changed",
      params: { locale: "zh-CN" },
      protocol: pluginHostProtocolV8,
      type: "command",
    })
    expect(client.closed).toBeTrue()
  })

  test("disconnects synchronously, rejects in-flight work, closes the port, and remains idempotent", async () => {
    const port = new FakePort()
    const fatal = mock(() => undefined)
    const client = createPluginHostClient({
      manifest,
      onFatalError: fatal,
      port,
      requestIdPrefix: "close",
    })
    const pending = client.callHostApi("host.context.get")

    client.close()
    expect(client.closed).toBeTrue()
    expect(port.sent).toEqual([
      {
        id: "close-1",
        method: "host.context.get",
        protocol: pluginHostProtocolV8,
        type: "request",
      },
      {
        protocol: pluginHostProtocolV8,
        type: "disconnect",
      },
    ])
    expect(port.closeCalls).toBe(1)
    await expect(pending).rejects.toMatchObject({ code: "closed" })
    expect(fatal).not.toHaveBeenCalled()

    client.close()
    expect(port.sent).toHaveLength(2)
    expect(port.closeCalls).toBe(1)
  })

  test("still closes locally when posting the disconnect control envelope fails", () => {
    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "failed-close" })
    port.failPost = true

    expect(() => client.close()).not.toThrow()
    expect(client.closed).toBeTrue()
    expect(port.closeCalls).toBe(1)
    expect(port.sent).toHaveLength(0)
  })

  test("requires the Web client negotiation baseline without constraining static Plugins", () => {
    const staticManifest = parsePluginManifestV8({
      capabilities: ["pet.activity.read", "pet.activity.open", "pet.preferences.write"],
      contributes: {
        pet: {
          library: "pets/library.json",
          overlay: "pets/overlay.html",
          protocol: "convax.pet-host/1",
          settings: "pets/settings.html",
        },
      },
      description: "Static Plugin",
      hostApi: { major: 3, optional: [], required: [] },
      id: "static-plugin",
      name: "Static Plugin",
      schema: "convax.plugin/8",
      version: "1.0.0",
    })
    expect(() =>
      createPluginHostClient({
        manifest: staticManifest,
        port: new FakePort(),
      }),
    ).toThrow("requires an entry and required host.context.get")
  })

  test("keeps Catalog Host calls orthogonal to P2P availability and invoke envelopes", async () => {
    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "test" })

    const host = client.callHostApi("host.context.get")
    expect(port.sent[0]).toEqual({
      id: "test-1",
      method: "host.context.get",
      protocol: pluginHostProtocolV8,
      type: "request",
    })
    const context = hostContextResult()
    port.emit(response("test-1", context))
    expect(await host).toEqual(context)

    const availability = client.getCapabilityAvailability("media.inspect")
    expect(port.sent[1]).toEqual({
      capabilityId: "media.inspect",
      id: "test-2",
      protocol: pluginHostProtocolV8,
      type: "capability-availability",
    })
    port.emit(
      response("test-2", {
        available: true,
        capabilityId: "media.inspect",
        requirement: "optional",
        version: "1.1.0",
      }),
    )
    expect(await availability).toEqual({
      available: true,
      capabilityId: "media.inspect",
      requirement: "optional",
      version: "1.1.0",
    })

    const invocation = client.invokeCapability("media.transform", { text: "hello" })
    expect(port.sent[2]).toEqual({
      capabilityId: "media.transform",
      id: "test-3",
      input: { text: "hello" },
      protocol: pluginHostProtocolV8,
      type: "capability-invoke",
    })
    port.emit(response("test-3", { value: 3 }))
    expect(await invocation).toEqual({ value: 3 })
    expect(port.started).toBeTrue()
  })

  test("returns structured optional-provider unavailability without exposing provider identity", async () => {
    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "optional" })
    const result = client.getCapabilityAvailability("media.inspect")
    port.emit(
      response("optional-1", {
        available: false,
        capabilityId: "media.inspect",
        reason: "provider-missing",
        recoverable: true,
        requirement: "optional",
      }),
    )
    expect(await result).toEqual({
      available: false,
      capabilityId: "media.inspect",
      reason: "provider-missing",
      recoverable: true,
      requirement: "optional",
    })
  })

  test("caches structured Host API availability and supports explicit refresh/require", async () => {
    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "api-availability" })
    const first = client.getHostApiAvailability("canvas.resource.image.create")
    const concurrent = client.getHostApiAvailability("canvas.resource.image.create")
    expect(port.sent[0]).toMatchObject({ method: "host.context.get", type: "request" })
    expect(port.sent).toHaveLength(1)
    port.emit(
      response(
        "api-availability-1",
        hostContextResult(1, [
          {
            available: false,
            contractSince: "2.0.0",
            id: "canvas.resource.image.create",
            reason: "setup-required",
            recoverable: true,
            since: "1.0.0",
          },
        ]),
      ),
    )
    await expect(first).resolves.toEqual({
      available: false,
      contractSince: "2.0.0",
      id: "canvas.resource.image.create",
      reason: "setup-required",
      recoverable: true,
      since: "1.0.0",
    })
    await expect(concurrent).resolves.toMatchObject({ available: false, reason: "setup-required" })
    await expect(client.requireHostApi("canvas.resource.image.create")).rejects.toBeInstanceOf(
      PluginApiUnavailableError,
    )
    expect(port.sent).toHaveLength(1)

    const refreshed = client.getHostApiAvailability("canvas.resource.image.create", { refresh: true })
    expect(port.sent[1]).toMatchObject({ method: "host.context.get", type: "request" })
    port.emit(
      response(
        "api-availability-2",
        hostContextResult(2, [
          {
            available: true,
            catalogVersion: "2.0.0",
            contractSince: "2.0.0",
            id: "canvas.resource.image.create",
            since: "1.0.0",
          },
        ]),
      ),
    )
    await expect(refreshed).resolves.toMatchObject({ available: true })
    await expect(client.requireHostApi("canvas.resource.image.create")).resolves.toMatchObject({
      available: true,
    })
    await expect(client.getHostApiAvailability("host.context.get")).resolves.toEqual({
      available: false,
      contractSince: "3.0.0",
      id: "host.context.get",
      reason: "unsupported-host",
      recoverable: false,
      since: "1.0.0",
    })
    expect(port.sent).toHaveLength(2)
  })

  test("exposes discriminated API/capability/protocol remote errors and rejects wrong API codes", async () => {
    const capabilityPort = new FakePort()
    const capabilityClient = createPluginHostClient({
      manifest,
      port: capabilityPort,
      requestIdPrefix: "capability-error",
    })
    const capabilityCall = capabilityClient.invokeCapability("media.transform", { text: "hello" })
    capabilityPort.emit(
      failure("capability-error-1", {
        code: "execution-failed",
        kind: "capability",
        message: "Provider execution failed.",
        recoverable: false,
      }),
    )
    try {
      await capabilityCall
      throw new Error("expected remote failure")
    } catch (error) {
      expect(error).toBeInstanceOf(PluginHostRemoteError)
      if (!(error instanceof PluginHostRemoteError)) throw error
      expect({ code: error.code, kind: error.kind, recoverable: error.recoverable }).toEqual({
        code: "execution-failed",
        kind: "capability",
        recoverable: false,
      })
    }

    const apiPort = new FakePort()
    const apiClient = createPluginHostClient({ manifest, port: apiPort, requestIdPrefix: "api-error" })
    const apiCall = apiClient.callHostApi("host.context.get")
    apiPort.emit(
      failure("api-error-1", {
        code: "stale-context",
        kind: "api",
        message: "Context changed.",
        recoverable: true,
      }),
    )
    try {
      await apiCall
      throw new Error("expected remote failure")
    } catch (error) {
      expect(error).toBeInstanceOf(PluginHostRemoteError)
      if (!(error instanceof PluginHostRemoteError)) throw error
      expect({ code: error.code, kind: error.kind, recoverable: error.recoverable }).toEqual({
        code: "stale-context",
        kind: "api",
        recoverable: true,
      })
    }

    const protocolPort = new FakePort()
    const protocolClient = createPluginHostClient({
      manifest,
      port: protocolPort,
      requestIdPrefix: "protocol-error",
    })
    const protocolCall = protocolClient.callHostApi("host.context.get")
    protocolPort.emit(
      failure("protocol-error-1", {
        code: "invalid-request",
        kind: "protocol",
        message: "Malformed request.",
        recoverable: false,
      }),
    )
    await expect(protocolCall).rejects.toBeInstanceOf(PluginHostRemoteError)

    const wrongPort = new FakePort()
    const wrongClient = createPluginHostClient({ manifest, port: wrongPort, requestIdPrefix: "wrong-error" })
    const wrongCall = wrongClient.callHostApi("host.context.get")
    wrongPort.emit(
      failure("wrong-error-1", {
        code: "permission-denied",
        kind: "api",
        message: "Not an allowed host.context.get code.",
        recoverable: false,
      }),
    )
    await expect(wrongCall).rejects.toBeInstanceOf(PluginHostProtocolError)
    expect(wrongClient.closed).toBeTrue()
  })

  test("rejects undeclared imports and invalid input before posting", async () => {
    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "input" })
    await expect(
      client.invokeCapability("media.transform", { text: "x", secret: "not declared" } as never),
    ).rejects.toThrow("unsupported property")
    await expect(client.getCapabilityAvailability("media.undeclared" as never)).rejects.toThrow("not declared")
    expect(port.sent).toHaveLength(0)
  })

  test("fails closed when a successful response violates the declared output schema", async () => {
    const port = new FakePort()
    const fatal: PluginHostProtocolError[] = []
    const client = createPluginHostClient({
      manifest,
      onFatalError: (error) => fatal.push(error),
      port,
      requestIdPrefix: "schema",
    })
    const result = client.invokeCapability("media.transform", { text: "hello" })
    port.emit(response("schema-1", { value: "wrong" }))
    await expect(result).rejects.toBeInstanceOf(PluginHostProtocolError)
    expect(fatal[0]?.code).toBe("invalid-result")
    expect(client.closed).toBeTrue()
  })

  test("preflights hostile Web messages iteratively before deep contract parsing", async () => {
    const statePort = new FakePort()
    const stateClient = createPluginHostClient({
      manifest: {
        ...manifest,
        hostApi: {
          ...manifest.hostApi,
          optional: ["canvas.node.state.replace", "canvas.resource.image.create"],
        },
      },
      port: statePort,
      requestIdPrefix: "state-bytes",
    })
    await expect(
      stateClient.callHostApi("canvas.node.state.replace", {
        state: { payload: "x".repeat(300 * 1024) },
      }),
    ).rejects.toThrow("exceeds 262144 bytes")
    expect(statePort.sent).toHaveLength(0)

    const hostile: Record<string, unknown> = {}
    let cursor = hostile
    for (let depth = 0; depth < 10_000; depth += 1) {
      const next: Record<string, unknown> = {}
      cursor.next = next
      cursor = next
    }
    expect(() => assertPluginHostMessageByteLength(hostile, 1024 * 1024, "Hostile message")).toThrow(
      "bounded acyclic JSON tree",
    )

    const responsePort = new FakePort()
    const fatal: PluginHostProtocolError[] = []
    const responseClient = createPluginHostClient({
      manifest,
      onFatalError: (error) => fatal.push(error),
      port: responsePort,
      requestIdPrefix: "hostile-response",
    })
    const pending = responseClient.callHostApi("host.context.get")
    responsePort.emit(response("hostile-response-1", hostile))
    await expect(pending).rejects.toBeInstanceOf(PluginHostProtocolError)
    expect(fatal[0]?.code).toBe("invalid-envelope")
    expect(responseClient.closed).toBeTrue()
  })

  test("sends sender-scoped cancel and treats a later response as a fatal transport violation", async () => {
    const port = new FakePort()
    const fatal: PluginHostProtocolError[] = []
    const signal = new FakeAbortSignal()
    const client = createPluginHostClient({
      manifest,
      onFatalError: (error) => fatal.push(error),
      port,
      requestIdPrefix: "abort",
    })
    const result = client.invokeCapability("media.transform", { text: "hello" }, { signal })
    signal.abort("user")
    await expect(result).rejects.toBeInstanceOf(PluginHostAbortError)
    expect(port.sent[1]).toEqual({
      id: "abort-1",
      protocol: pluginHostProtocolV8,
      type: "cancel",
    })
    port.emit(response("abort-1", { value: 1 }))
    expect(client.closed).toBeTrue()
    expect(fatal[0]?.code).toBe("unknown-response")
  })

  test("fails closed on unknown and duplicate responses without retaining an unbounded response ledger", async () => {
    const unknownPort = new FakePort()
    const unknownClient = createPluginHostClient({
      manifest,
      port: unknownPort,
      requestIdPrefix: "unknown",
    })
    unknownPort.emit(response("not-issued", {}))
    expect(unknownClient.closed).toBeTrue()

    const duplicatePort = new FakePort()
    const duplicateClient = createPluginHostClient({
      manifest,
      port: duplicatePort,
      requestIdPrefix: "duplicate",
    })
    const result = duplicateClient.getCapabilityAvailability("media.inspect")
    const available = {
      available: true,
      capabilityId: "media.inspect",
      requirement: "optional",
      version: "1.0.0",
    } as const
    duplicatePort.emit(response("duplicate-1", available))
    await expect(result).resolves.toEqual(available)
    duplicatePort.emit(response("duplicate-1", available))
    expect(duplicateClient.closed).toBeTrue()
  })

  test("admits valid large Catalog payloads and bounds concurrent requests without poisoning future calls", async () => {
    const bytesPort = new FakePort()
    const bytesClient = createPluginHostClient({
      manifest,
      port: bytesPort,
      requestIdPrefix: "bytes",
    })
    const largeCall = bytesClient.callHostApi("canvas.resource.image.create", {
      dataUrl: `data:image/png;base64,${"x".repeat(1024 * 1024)}`,
      name: "large.png",
    })
    expect(bytesPort.sent).toHaveLength(1)
    const imageResult = {
      createdNodeId: "node-1",
      operationReceipt: {
        actorId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        baseFrontierDigest: "0".repeat(64),
        format: "convax.canvas-operation-receipt/2",
        historyMaterialDigest: null,
        intentDigest: "1".repeat(64),
        intentKind: "canvas.plugin.creation-group/2",
        operationId: "aaaaaaaaaaaaaaaaaaaaaa",
        resultEntities: [{ id: "node-1", incarnation: "aaaaaaaaaaaaaaaaaaaaaa", kind: "node" }],
        semanticRoot: true,
      },
      projection: {
        edges: [],
        id: "canvas-1",
        nodes: [
          {
            id: "node-1",
            kind: "file",
            label: "large.png",
            position: { x: 0, y: 0 },
            size: { height: 100, width: 100 },
          },
        ],
        title: "Canvas",
      },
    } as const
    bytesPort.emit(response("bytes-1", imageResult))
    await expect(largeCall).resolves.toEqual(imageResult)
    expect(bytesClient.closed).toBeFalse()

    const port = new FakePort()
    const client = createPluginHostClient({ manifest, port, requestIdPrefix: "limit" })
    const requests = Array.from({ length: maximumPluginHostInFlightRequests }, () =>
      client.callHostApi("host.context.get"),
    )
    await expect(client.callHostApi("host.context.get")).rejects.toThrow("in-flight")
    for (let index = 0; index < requests.length; index += 1) {
      port.emit(response(`limit-${(index + 1).toString(36)}`, hostContextResult(index)))
    }
    await expect(Promise.all(requests)).resolves.toHaveLength(maximumPluginHostInFlightRequests)
    expect(client.closed).toBeFalse()
  })
})
