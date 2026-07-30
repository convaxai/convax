import { describe, expect, mock, test } from "bun:test"
import {
  parsePluginCapabilityDeclaration,
  type PluginCapabilityDeclaration,
  type PluginCapabilityRuntimeUnavailableReason,
} from "@convax/plugin-sdk"

import {
  PluginCapabilityBroker,
  PluginCapabilityBrokerError,
  type PluginCapabilityBrokerLimits,
  type PluginCapabilityExecutorPort,
  type PluginCapabilityLease,
  type PluginCapabilityLeasePort,
  type PluginCapabilityPluginIdentity,
  type PluginCapabilityReadinessPort,
  type PluginCapabilityRuntimeLease,
} from "./plugin-capability-broker"
import { planPluginCapabilityBindings } from "./plugin-capability-binding-plan"

const digest = (character: string) => character.repeat(64)
const objectSchema = {
  additionalProperties: false,
  properties: { text: { maxLength: 128, type: "string" } },
  required: ["text"],
  type: "object",
} as const

function declaration(input: {
  exports?: Array<{ id: string; operation?: string; version?: `${number}.${number}.${number}` }>
  optional?: Array<{ id: string; minimum?: `${number}.${number}.${number}` }>
  required?: Array<{ id: string; minimum?: `${number}.${number}.${number}` }>
}): PluginCapabilityDeclaration {
  return parsePluginCapabilityDeclaration({
    exports: (input.exports ?? []).map((entry) => ({
      docs: { request: "Text.", response: "Text.", summary: `Provides ${entry.id}.` },
      id: entry.id,
      inputSchema: objectSchema,
      operation: entry.operation ?? "capability.invoke",
      outputSchema: objectSchema,
      sideEffect: "execute",
      version: entry.version ?? "1.0.0",
    })),
    imports: {
      optional: (input.optional ?? []).map((entry) => ({
        id: entry.id,
        inputSchema: objectSchema,
        outputSchema: objectSchema,
        version: { maximumExclusive: "2.0.0", minimum: entry.minimum ?? "1.0.0" },
      })),
      required: (input.required ?? []).map((entry) => ({
        id: entry.id,
        inputSchema: objectSchema,
        outputSchema: objectSchema,
        version: { maximumExclusive: "2.0.0", minimum: entry.minimum ?? "1.0.0" },
      })),
    },
  })
}

function identity(pluginId: string, snapshotCharacter: string): PluginCapabilityPluginIdentity {
  return {
    activeRevision: 7,
    activeSetDigest: digest("a"),
    pluginId,
    pluginVersion: "8.0.0",
    snapshotDigest: digest(snapshotCharacter),
  }
}

function plugin(pluginId: string, snapshotCharacter: string, capabilities: PluginCapabilityDeclaration) {
  return { capabilities, identity: identity(pluginId, snapshotCharacter) }
}

function runtimeLease(provider: PluginCapabilityPluginIdentity): PluginCapabilityRuntimeLease {
  let released = false
  return {
    generation: `runtime-${provider.snapshotDigest}`,
    provider,
    get released() {
      return released
    },
    release() {
      released = true
    },
  }
}

const runtimeReadiness: PluginCapabilityReadinessPort = {
  evaluate: async ({ capability, provider }) => ({
    available: true,
    runtime: runtimeLease(provider),
    tools: [
      {
        inputSchema: capability.inputSchema,
        name: capability.operation,
        outputSchema: capability.outputSchema,
      },
    ],
  }),
}

describe("Plugin capability binding plan", () => {
  test("binds one compatible provider and records optional absence structurally", () => {
    const result = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin("caller", "b", declaration({ required: [{ id: "media.render" }], optional: [{ id: "media.inspect" }] })),
        plugin("provider", "c", declaration({ exports: [{ id: "media.render", version: "1.4.0" }] })),
      ],
    })
    expect(result.ok).toBeTrue()
    if (!result.ok) return
    expect(result.plan.bindings.find((entry) => entry.capabilityId === "media.render")?.provider?.pluginId).toBe(
      "provider",
    )
    expect(result.plan.bindings.find((entry) => entry.capabilityId === "media.inspect")?.availability).toEqual({
      available: false,
      capabilityId: "media.inspect",
      reason: "provider-missing",
      recoverable: true,
      requirement: "optional",
    })
  })

  test("fails activation for missing, ambiguous, incompatible, or cyclic required providers", () => {
    const missing = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [plugin("caller", "b", declaration({ required: [{ id: "media.render" }] }))],
    })
    expect(missing).toMatchObject({ ok: false, issues: [{ code: "required-provider-missing" }] })

    const ambiguous = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin("caller", "b", declaration({ required: [{ id: "media.render" }] })),
        plugin("provider-a", "c", declaration({ exports: [{ id: "media.render" }] })),
        plugin("provider-b", "d", declaration({ exports: [{ id: "media.render" }] })),
      ],
    })
    expect(ambiguous).toMatchObject({ ok: false, issues: [{ code: "required-provider-ambiguous" }] })

    const incompatible = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin("caller", "b", declaration({ required: [{ id: "media.render", minimum: "1.5.0" }] })),
        plugin("provider", "c", declaration({ exports: [{ id: "media.render", version: "1.4.0" }] })),
      ],
    })
    expect(incompatible).toMatchObject({ ok: false, issues: [{ code: "required-provider-incompatible" }] })

    const cyclic = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin("a-plugin", "b", declaration({ exports: [{ id: "capability.a" }], required: [{ id: "capability.b" }] })),
        plugin("b-plugin", "c", declaration({ exports: [{ id: "capability.b" }], required: [{ id: "capability.a" }] })),
      ],
    })
    expect(cyclic).toMatchObject({ ok: false, issues: [{ code: "required-dependency-cycle" }] })
  })

  test("allows an optional dependency cycle in the plan for runtime budget enforcement", () => {
    const result = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin("a-plugin", "b", declaration({ exports: [{ id: "capability.a" }], optional: [{ id: "capability.b" }] })),
        plugin("b-plugin", "c", declaration({ exports: [{ id: "capability.b" }], optional: [{ id: "capability.a" }] })),
      ],
    })
    expect(result.ok).toBeTrue()
  })
})

async function createBrokerFixture(
  options: {
    declarations?: {
      caller?: PluginCapabilityDeclaration
      provider?: PluginCapabilityDeclaration
    }
    execute?: PluginCapabilityExecutorPort["execute"]
    limits?: PluginCapabilityBrokerLimits
    readiness?: PluginCapabilityReadinessPort
    readinessReason?: PluginCapabilityRuntimeUnavailableReason
  } = {},
) {
  const result = planPluginCapabilityBindings({
    activeRevision: 7,
    activeSetDigest: digest("a"),
    plugins: [
      plugin("caller", "b", options.declarations?.caller ?? declaration({ required: [{ id: "media.render" }] })),
      plugin("provider", "c", options.declarations?.provider ?? declaration({ exports: [{ id: "media.render" }] })),
    ],
  })
  if (!result.ok) throw new Error("Invalid fixture")
  const acquired: string[] = []
  const released: string[] = []
  const acquireBoundPair = mock(
    async (expected: {
      activeRevision: number
      activeSetDigest: string
      caller: PluginCapabilityPluginIdentity
      provider: PluginCapabilityPluginIdentity
    }): Promise<PluginCapabilityLease> => {
      acquired.push(`${expected.caller.pluginId}->${expected.provider.pluginId}`)
      let didRelease = false
      return {
        activeRevision: expected.activeRevision,
        activeSetDigest: expected.activeSetDigest,
        caller: expected.caller,
        provider: expected.provider,
        get released() {
          return didRelease
        },
        release() {
          if (didRelease) return
          didRelease = true
          released.push(`${expected.caller.pluginId}->${expected.provider.pluginId}`)
        },
      }
    },
  )
  const execute = mock(
    options.execute ?? (async ({ input }: Parameters<PluginCapabilityExecutorPort["execute"]>[0]) => input),
  )
  const broker = await PluginCapabilityBroker.fromPublishedActiveSet({
    executor: { execute },
    leases: { acquireBoundPair },
    plans: { loadPublished: async () => result.plan },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    readiness:
      options.readiness ??
      ({
        evaluate: async ({ capability, provider }) =>
          options.readinessReason
            ? { available: false as const, reason: options.readinessReason, recoverable: true }
            : {
                available: true as const,
                runtime: runtimeLease(provider),
                tools: [
                  {
                    inputSchema: capability.inputSchema,
                    name: capability.operation,
                    outputSchema: capability.outputSchema,
                  },
                ],
              },
      } satisfies PluginCapabilityReadinessPort),
  })
  return { acquired, broker, execute, released, caller: identity("caller", "b"), plan: result.plan }
}

describe("Plugin capability broker", () => {
  test("expires the exact provider invocation authority when execution settles", async () => {
    let authority: Parameters<PluginCapabilityExecutorPort["execute"]>[0]["authority"] | undefined
    const fixture = await createBrokerFixture({
      execute: async (input) => {
        authority = input.authority
        await input.authority.assertActive()
        return input.input
      },
    })
    await fixture.broker.invoke({
      caller: fixture.caller,
      capabilityId: "media.render",
      input: { text: "authorized" },
      requestId: "authority-lifetime",
    })

    expect(authority).toMatchObject({
      consumerPluginId: "caller",
      providerPluginId: "provider",
    })
    await expect(authority!.assertActive()).rejects.toThrow("no longer active")
  })

  test("holds exact caller and provider leases, validates both schemas, and executes as provider", async () => {
    const fixture = await createBrokerFixture()
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "request-1",
      }),
    ).resolves.toEqual({ text: "hello" })
    expect(fixture.acquired).toEqual(["caller->provider"])
    expect(fixture.released).toEqual(["caller->provider"])
    expect(fixture.execute).toHaveBeenCalledTimes(1)
    expect(fixture.execute.mock.calls[0]?.[0].provider.pluginId).toBe("provider")
    expect("callerGrants" in fixture.execute.mock.calls[0]![0]).toBeFalse()
  })

  test("rejects invalid input before execution and invalid provider output after execution", async () => {
    const fixture = await createBrokerFixture()
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello", extra: true },
        requestId: "invalid-input",
      }),
    ).rejects.toMatchObject({ code: "invalid-request" })
    expect(fixture.execute).not.toHaveBeenCalled()

    const badOutput = await createBrokerFixture({ execute: async () => ({ leaked: "value" }) })
    await expect(
      badOutput.broker.invoke({
        caller: badOutput.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "invalid-output",
      }),
    ).rejects.toMatchObject({ code: "invalid-response" })
    expect(badOutput.released).toEqual(["caller->provider"])
  })

  test("rejects only an in-flight duplicate and preserves the operation id for provider replay handling", async () => {
    let finish!: (value: { text: string }) => void
    const pending = new Promise<{ text: string }>((resolve) => {
      finish = resolve
    })
    const operationIds: string[] = []
    let firstExecution = true
    const fixture = await createBrokerFixture({
      execute: async ({ input, operationId }) => {
        operationIds.push(operationId)
        if (!firstExecution) return input
        firstExecution = false
        return pending
      },
    })
    const first = fixture.broker.invoke({
      caller: fixture.caller,
      capabilityId: "media.render",
      input: { text: "hello" },
      requestId: "same-request",
    })
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "same-request",
      }),
    ).rejects.toMatchObject({ code: "duplicate-request" })
    finish({ text: "done" })
    await expect(first).resolves.toEqual({ text: "done" })
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "same-request",
      }),
    ).resolves.toEqual({ text: "hello" })
    expect(operationIds).toHaveLength(2)
    expect(new Set(operationIds).size).toBe(1)
    expect(fixture.execute).toHaveBeenCalledTimes(2)
  })

  test("releases concurrency capacity after settlement while preserving in-flight overload", async () => {
    let finish!: (value: { text: string }) => void
    const pending = new Promise<{ text: string }>((resolve) => {
      finish = resolve
    })
    let firstExecution = true
    const fixture = await createBrokerFixture({
      execute: async ({ input }) => {
        if (!firstExecution) return input
        firstExecution = false
        return pending
      },
      limits: { maximumInFlight: 1, maximumInFlightPerCaller: 1 },
    })
    const first = fixture.broker.invoke({
      caller: fixture.caller,
      capabilityId: "media.render",
      input: { text: "first" },
      requestId: "first-request",
    })
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "second" },
        requestId: "second-request",
      }),
    ).rejects.toMatchObject({ code: "overloaded" })
    finish({ text: "first" })
    await expect(first).resolves.toEqual({ text: "first" })
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "second" },
        requestId: "second-request",
      }),
    ).resolves.toEqual({ text: "second" })
  })

  test("does not permanently overload after more than the former request-ledger limit", async () => {
    const fixture = await createBrokerFixture()
    const requestCount = 4_097
    for (let index = 0; index < requestCount; index += 1) {
      await expect(
        fixture.broker.invoke({
          caller: fixture.caller,
          capabilityId: "media.render",
          input: { text: `request-${index}` },
          requestId: `request-${index}`,
        }),
      ).resolves.toEqual({ text: `request-${index}` })
    }
    expect(fixture.execute).toHaveBeenCalledTimes(requestCount)
  })

  test("reports runtime availability and does not call a disabled provider", async () => {
    const fixture = await createBrokerFixture({ readinessReason: "disabled" })
    await expect(fixture.broker.getAvailability(fixture.caller, "media.render")).resolves.toMatchObject({
      available: false,
      reason: "disabled",
      recoverable: true,
    })
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "disabled-provider",
      }),
    ).rejects.toMatchObject({ code: "unavailable" })
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  test("keeps readiness cancellation typed as aborted and releases runtime, ActiveSet lease, and capacity", async () => {
    let releaseReadiness!: () => void
    const readinessGate = new Promise<void>((resolve) => {
      releaseReadiness = resolve
    })
    let observeReadiness!: () => void
    const readinessObserved = new Promise<void>((resolve) => {
      observeReadiness = resolve
    })
    let runtimeReleased = 0
    const fixture = await createBrokerFixture({
      limits: { maximumInFlight: 1, maximumInFlightPerCaller: 1 },
      readiness: {
        evaluate: async ({ capability, provider }) => {
          observeReadiness()
          await readinessGate
          const runtime = runtimeLease(provider)
          return {
            available: true,
            runtime: {
              ...runtime,
              get released() {
                return runtime.released
              },
              release() {
                if (!runtime.released) runtimeReleased += 1
                runtime.release()
              },
            },
            tools: [
              {
                inputSchema: capability.inputSchema,
                name: capability.operation,
                outputSchema: capability.outputSchema,
              },
            ],
          }
        },
      },
    })
    const controller = new AbortController()
    const availability = fixture.broker.getAvailability(fixture.caller, "media.render", controller.signal)
    await readinessObserved
    controller.abort("availability canceled")
    releaseReadiness()

    await expect(availability).rejects.toMatchObject({ code: "aborted" })
    expect(runtimeReleased).toBe(1)
    expect(fixture.released).toEqual(["caller->provider"])
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "capacity restored" },
        requestId: "after-availability-cancel",
      }),
    ).resolves.toEqual({ text: "capacity restored" })
  })

  test("counts availability inspection against the shared concurrency budget", async () => {
    let releaseReadiness!: () => void
    const readinessGate = new Promise<void>((resolve) => {
      releaseReadiness = resolve
    })
    let observeReadiness!: () => void
    const readinessObserved = new Promise<void>((resolve) => {
      observeReadiness = resolve
    })
    const fixture = await createBrokerFixture({
      limits: { maximumInFlight: 1, maximumInFlightPerCaller: 1 },
      readiness: {
        evaluate: async ({ capability, provider }) => {
          observeReadiness()
          await readinessGate
          return {
            available: true,
            runtime: runtimeLease(provider),
            tools: [
              {
                inputSchema: capability.inputSchema,
                name: capability.operation,
                outputSchema: capability.outputSchema,
              },
            ],
          }
        },
      },
    })
    const availability = fixture.broker.getAvailability(fixture.caller, "media.render")
    await readinessObserved
    await expect(
      fixture.broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "over budget" },
        requestId: "availability-budget",
      }),
    ).rejects.toMatchObject({ code: "overloaded" })
    releaseReadiness()
    await expect(availability).resolves.toMatchObject({ available: true })
  })

  test("fails closed when tools/list does not match the exported operation schemas", async () => {
    const fixture = await createBrokerFixture()
    const broker = await PluginCapabilityBroker.fromPublishedActiveSet({
      executor: { execute: fixture.execute },
      leases: {
        acquireBoundPair: async (expected) => ({
          ...expected,
          released: false,
          release() {},
        }),
      },
      plans: { loadPublished: async () => fixture.plan },
      readiness: {
        evaluate: async ({ capability, provider }) => ({
          available: true,
          runtime: runtimeLease(provider),
          tools: [
            {
              inputSchema: {
                additionalProperties: false,
                properties: {},
                required: [],
                type: "object",
              },
              name: capability.operation,
              outputSchema: capability.outputSchema,
            },
          ],
        }),
      },
    })

    await expect(broker.getAvailability(fixture.caller, "media.render")).resolves.toMatchObject({
      available: false,
      reason: "contract-mismatch",
      recoverable: false,
    })
    await expect(
      broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "contract-mismatch",
      }),
    ).rejects.toMatchObject({
      availability: { reason: "contract-mismatch", recoverable: false },
      code: "unavailable",
    })
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  test("rejects stale lease identity rather than running against newer bytes", async () => {
    const fixture = await createBrokerFixture()
    const staleBroker = await PluginCapabilityBroker.fromPublishedActiveSet({
      executor: { execute: async ({ input }) => input },
      leases: {
        acquireBoundPair: async (expected) => ({
          activeRevision: expected.activeRevision + 1,
          activeSetDigest: digest("f"),
          caller: expected.caller,
          provider: expected.provider,
          released: false,
          release() {},
        }),
      },
      plans: { loadPublished: async () => fixture.plan },
      readiness: runtimeReadiness,
    })
    await expect(
      staleBroker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "stale",
      }),
    ).rejects.toBeInstanceOf(PluginCapabilityBrokerError)
  })

  test("rejects an ActiveSet switch race before provider execution", async () => {
    const fixture = await createBrokerFixture()
    let activeRevision = 7
    const acquireBoundPair = mock(
      async (expected: {
        activeRevision: number
        activeSetDigest: string
        caller: PluginCapabilityPluginIdentity
        provider: PluginCapabilityPluginIdentity
      }): Promise<PluginCapabilityLease> => {
        activeRevision = 8
        return {
          activeRevision,
          activeSetDigest: digest("f"),
          caller: { ...expected.caller, activeRevision, activeSetDigest: digest("f") },
          provider: { ...expected.provider, activeRevision, activeSetDigest: digest("f") },
          released: false,
          release() {},
        }
      },
    )
    const execute = mock(async ({ input }: { input: unknown }) => input)
    const broker = await PluginCapabilityBroker.fromPublishedActiveSet({
      executor: { execute },
      leases: { acquireBoundPair },
      plans: { loadPublished: async () => fixture.plan },
      readiness: runtimeReadiness,
    })
    await expect(
      broker.invoke({
        caller: fixture.caller,
        capabilityId: "media.render",
        input: { text: "hello" },
        requestId: "switch-race",
      }),
    ).rejects.toMatchObject({ code: "lease-mismatch" })
    expect(execute).not.toHaveBeenCalled()
  })

  test("scopes nested request ids by their parent operation chain", async () => {
    const result = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin("caller", "b", declaration({ required: [{ id: "capability.gateway" }] })),
        plugin(
          "gateway",
          "c",
          declaration({
            exports: [{ id: "capability.gateway" }],
            optional: [{ id: "capability.child" }],
          }),
        ),
        plugin("child", "d", declaration({ exports: [{ id: "capability.child" }] })),
      ],
    })
    if (!result.ok) throw new Error("Invalid nested fixture")
    const acquireBoundPair = mock(
      async (expected: {
        activeRevision: number
        activeSetDigest: string
        caller: PluginCapabilityPluginIdentity
        provider: PluginCapabilityPluginIdentity
      }): Promise<PluginCapabilityLease> => ({
        ...expected,
        released: false,
        release() {},
      }),
    )
    const childOperationIds: string[] = []
    const execute = mock(
      async ({ capability, input, invoke, operationId }: Parameters<PluginCapabilityExecutorPort["execute"]>[0]) => {
        if (capability.id === "capability.gateway") {
          return invoke({ capabilityId: "capability.child", input, requestId: "same-child-id" })
        }
        childOperationIds.push(operationId)
        return input
      },
    )
    const broker = await PluginCapabilityBroker.fromPublishedActiveSet({
      executor: { execute },
      leases: { acquireBoundPair },
      plans: { loadPublished: async () => result.plan },
      readiness: runtimeReadiness,
    })
    const caller = identity("caller", "b")
    await expect(
      Promise.all([
        broker.invoke({
          caller,
          capabilityId: "capability.gateway",
          input: { text: "one" },
          requestId: "outer-one",
        }),
        broker.invoke({
          caller,
          capabilityId: "capability.gateway",
          input: { text: "two" },
          requestId: "outer-two",
        }),
      ]),
    ).resolves.toEqual([{ text: "one" }, { text: "two" }])
    expect(childOperationIds).toHaveLength(2)
    expect(childOperationIds[0]).not.toBe(childOperationIds[1])
  })

  test("nested calls use only the provider's imports and reject optional-cycle re-entry", async () => {
    const authorityPlan = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin(
          "caller",
          "b",
          declaration({
            required: [{ id: "capability.gateway" }, { id: "capability.secret" }],
          }),
        ),
        plugin(
          "gateway",
          "c",
          declaration({
            exports: [{ id: "capability.gateway" }],
          }),
        ),
        plugin("secret", "d", declaration({ exports: [{ id: "capability.secret" }] })),
      ],
    })
    if (!authorityPlan.ok) throw new Error("Invalid nested authority fixture")
    const lease = async (
      expected: Parameters<PluginCapabilityLeasePort["acquireBoundPair"]>[0],
    ): Promise<PluginCapabilityLease> => ({
      ...expected,
      released: false,
      release() {},
    })
    const authorityBroker = await PluginCapabilityBroker.fromPublishedActiveSet({
      executor: {
        async execute({ capability, input, invoke }) {
          if (capability.id === "capability.gateway") {
            return invoke({
              capabilityId: "capability.secret",
              input,
              requestId: "gateway-cannot-borrow-caller-import",
            })
          }
          return input
        },
      },
      leases: { acquireBoundPair: lease },
      plans: { loadPublished: async () => authorityPlan.plan },
      readiness: runtimeReadiness,
    })
    await expect(
      authorityBroker.invoke({
        caller: identity("caller", "b"),
        capabilityId: "capability.gateway",
        input: { text: "secret" },
        requestId: "outer-authority",
      }),
    ).rejects.toMatchObject({ code: "unavailable" })

    const cyclePlan = planPluginCapabilityBindings({
      activeRevision: 7,
      activeSetDigest: digest("a"),
      plugins: [
        plugin("caller", "b", declaration({ required: [{ id: "capability.a" }] })),
        plugin(
          "a-plugin",
          "c",
          declaration({
            exports: [{ id: "capability.a" }],
            optional: [{ id: "capability.b" }],
          }),
        ),
        plugin(
          "b-plugin",
          "d",
          declaration({
            exports: [{ id: "capability.b" }],
            optional: [{ id: "capability.a" }],
          }),
        ),
      ],
    })
    if (!cyclePlan.ok) throw new Error("Invalid optional-cycle fixture")
    const cycleBroker = await PluginCapabilityBroker.fromPublishedActiveSet({
      executor: {
        async execute({ capability, input, invoke }) {
          return invoke({
            capabilityId: capability.id === "capability.a" ? "capability.b" : "capability.a",
            input,
            requestId: `nested-${capability.id}`,
          })
        },
      },
      leases: { acquireBoundPair: lease },
      plans: { loadPublished: async () => cyclePlan.plan },
      readiness: runtimeReadiness,
    })
    await expect(
      cycleBroker.invoke({
        caller: identity("caller", "b"),
        capabilityId: "capability.a",
        input: { text: "cycle" },
        requestId: "outer-cycle",
      }),
    ).rejects.toMatchObject({ code: "reentrant-call" })
  })
})
