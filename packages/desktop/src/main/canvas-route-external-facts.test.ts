import { describe, expect, test } from "bun:test"
import type {
  OwnerExternalFactPortFactoryV2,
  OwnerExternalFactPortV2,
  OwnerIntentDependenciesV2,
} from "@convax/collaboration"

import {
  createRouteScopedCanvasFactResolverV2,
  createRouteScopedCanvasIncomingFactResolverV2,
} from "./canvas-route-external-facts"

describe("route-scoped Canvas external facts", () => {
  test("creates the attempt-scoped owner port for an empty dependency closure", async () => {
    const port = Object.freeze({ marker: "owner-port" }) as unknown as OwnerExternalFactPortV2<"canvas">
    const factory = {
      createAttemptPort({ declared }: { declared: OwnerIntentDependenciesV2<"canvas"> }) {
        expect(declared).toEqual({ validationArtifacts: [], externalFacts: [] })
        return { status: "created" as const, port }
      },
    } as OwnerExternalFactPortFactoryV2<"canvas">
    const resolve = createRouteScopedCanvasFactResolverV2({ factory })
    await expect(resolve({ scope: scope(), dependencies: { validationArtifacts: [], externalFacts: [] } }))
      .resolves.toEqual({ status: "resolved", port })
  })

  test("keeps every nonempty authority closure pending when no production verifier is installed", async () => {
    const factory = { createAttemptPort() { throw new Error("must not create") } } as unknown as OwnerExternalFactPortFactoryV2<"canvas">
    const resolve = createRouteScopedCanvasFactResolverV2({ factory })
    const artifact = { owner: "plugin" as const, format: "convax.plugin-validation-artifact/2", artifactDigest: "a".repeat(64) as never }
    await expect(resolve({ scope: scope(), dependencies: { validationArtifacts: [artifact], externalFacts: [] } }))
      .resolves.toEqual({ status: "pending" })
  })

  test("rejects an incoming frame that crosses the bound Canvas route", async () => {
    const factory = { createAttemptPort() { throw new Error("must not create") } } as unknown as OwnerExternalFactPortFactoryV2<"canvas">
    const resolve = createRouteScopedCanvasFactResolverV2({ factory })
    const incoming = createRouteScopedCanvasIncomingFactResolverV2({ scope: scope(), resolve })
    const frame = { header: { core: { scope: { ...scope(), shardEpoch: "AwMDAwMDAwMDAwMDAwMDAw" } } } } as never
    await expect(incoming.resolve({ frame, declaredDependencies: { validationArtifacts: [], externalFacts: [] } }))
      .resolves.toEqual({ status: "rejected" })
  })
})

function scope() {
  return {
    projectId: "project" as never,
    projectEpoch: "AQEBAQEBAQEBAQEBAQEBAQ" as never,
    docKind: "canvas" as const,
    docId: `cv_${"2".repeat(64)}` as never,
    shardEpoch: "AgICAgICAgICAgICAgICAg" as never,
  }
}
