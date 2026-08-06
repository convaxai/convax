import { describe, expect, mock, test } from "bun:test"
import type {
  OwnerExternalFactPortFactory,
  OwnerExternalFactPort,
  OwnerIntentDependencies,
} from "@convax/collaboration"
import {
  encodeBase64url,
  ordinarySha256,
  parseId128,
  parseProjectId,
} from "@convax/collaboration"
import { encodeCanvasExternalFactRequest } from "@convax/canvas/collaboration"
import { parseProjectIndexResourceReference, projectIndexResourceReferenceDigest } from "@convax/project"

import {
  createProjectIndexBackedCanvasExternalFactAuthority,
  createRouteScopedCanvasFactResolver,
  createRouteScopedCanvasIncomingFactResolver,
} from "./canvas-route-external-facts"

describe("route-scoped Canvas external facts", () => {
  test("creates the attempt-scoped owner port for an empty dependency closure", async () => {
    const port = Object.freeze({ marker: "owner-port" }) as unknown as OwnerExternalFactPort<"canvas">
    const factory = {
      createAttemptPort({ declared }: { declared: OwnerIntentDependencies<"canvas"> }) {
        expect(declared).toEqual({ validationArtifacts: [], externalFacts: [] })
        return { status: "created" as const, port }
      },
    } as OwnerExternalFactPortFactory<"canvas">
    const resolve = createRouteScopedCanvasFactResolver({ factory })
    await expect(resolve({ scope: scope(), dependencies: { validationArtifacts: [], externalFacts: [] } }))
      .resolves.toEqual({ status: "resolved", port })
  })

  test("keeps every nonempty authority closure pending when no production verifier is installed", async () => {
    const factory = { createAttemptPort() { throw new Error("must not create") } } as unknown as OwnerExternalFactPortFactory<"canvas">
    const resolve = createRouteScopedCanvasFactResolver({ factory })
    const artifact = { owner: "plugin" as const, format: "convax.plugin-validation-artifact", artifactDigest: "a".repeat(64) as never }
    await expect(resolve({ scope: scope(), dependencies: { validationArtifacts: [artifact], externalFacts: [] } }))
      .resolves.toEqual({ status: "pending" })
  })

  test("rejects an incoming frame that crosses the bound Canvas route", async () => {
    const factory = { createAttemptPort() { throw new Error("must not create") } } as unknown as OwnerExternalFactPortFactory<"canvas">
    const resolve = createRouteScopedCanvasFactResolver({ factory })
    const incoming = createRouteScopedCanvasIncomingFactResolver({ scope: scope(), resolve })
    const frame = { header: { core: { scope: { ...scope(), shardEpoch: "AwMDAwMDAwMDAwMDAwMDAw" } } } } as never
    await expect(incoming.resolve({ frame, declaredDependencies: { validationArtifacts: [], externalFacts: [] } }))
      .resolves.toEqual({ status: "rejected" })
  })

  test("verifies current resource proofs only from the exact live ProjectIndex reference", async () => {
    const fixture = currentResourceFixture()
    const queryCurrentResources = mock(async () => [{
      materializedPath: "Notes/a.md",
      reference: fixture.reference,
      storageClass: "project-file" as const,
    }])
    const authority = createProjectIndexBackedCanvasExternalFactAuthority({
      currentResources: { queryCurrentResources },
    })
    const request = {
      format: "convax.canvas-external-fact-request" as const,
      kind: "current-resources" as const,
      proofs: [fixture.proof],
    }
    await expect(authority.verify({ scope: fixture.scope, request, requirement: {} as never }))
      .resolves.toBe("verified")
    await expect(authority.verify({
      scope: fixture.scope,
      request: {
        ...request,
        proofs: [{ ...fixture.proof, resource: { ...fixture.proof.resource, contentDigest: "f".repeat(64) as never } }],
      },
      requirement: {} as never,
    })).resolves.toBe("rejected")
    expect(queryCurrentResources).toHaveBeenCalledWith({ projectId: fixture.scope.projectId })
  })

  test("rejects a resource fact envelope whose exact bytes do not match its declared digest", async () => {
    const fixture = currentResourceFixture()
    const request = {
      format: "convax.canvas-external-fact-request" as const,
      kind: "current-resources" as const,
      proofs: [fixture.proof],
    }
    const exactJcs = encodeCanvasExternalFactRequest(request)
    if (exactJcs === "rejected") throw new Error("fixture request is invalid")
    const verify = mock(async () => "verified" as const)
    const factory = { createAttemptPort() { throw new Error("must not create") } } as unknown as OwnerExternalFactPortFactory<"canvas">
    const resolve = createRouteScopedCanvasFactResolver({ factory, facts: { verify } })
    await expect(resolve({
      scope: fixture.scope,
      dependencies: {
        validationArtifacts: [],
        externalFacts: [{
          owner: "canvas",
          kind: "current-resources",
          factDigest: ordinarySha256(exactJcs),
          request: { exactJcs, sha256: "0".repeat(64) as never },
        }],
      },
    })).resolves.toEqual({ status: "rejected" })
    expect(verify).not.toHaveBeenCalled()
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

function currentResourceFixture() {
  const projectId = parseProjectId("project")
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
  const contentDigest = ordinarySha256(new TextEncoder().encode("hello"))
  const fileId = `pf_${"a".repeat(64)}`
  const reference = parseProjectIndexResourceReference({
    format: "convax.project-resource-reference",
    projectId,
    projectEpoch,
    entryFileId: fileId,
    familyPrimaryFileId: fileId,
    versionId: `pv_${"b".repeat(64)}`,
    canonicalUri: `convax-project://${projectId}/epochs/${projectEpoch}/entries/${fileId}?blob=sha256%3A${contentDigest}`,
    blob: {
      format: "convax.blob-ref",
      algorithm: "sha256",
      digest: contentDigest,
      byteLength: "5",
      mime: "text/markdown",
    },
    versionRecordDigest: ordinarySha256(new TextEncoder().encode("version")),
  })
  const ownerProofDigest = projectIndexResourceReferenceDigest(reference)
  return {
    reference,
    scope: { ...scope(), projectId, projectEpoch },
    proof: {
      format: "convax.canvas-resource-proof-ref" as const,
      mode: "current-owner-state" as const,
      ownerProofDigest,
      requireCurrentLiveVersion: true as const,
      resource: {
        format: "convax.canvas-resource-ref" as const,
        uri: reference.canonicalUri,
        mediaClass: "text" as const,
        mime: reference.blob.mime,
        byteLength: reference.blob.byteLength,
        contentDigest: reference.blob.digest,
        ownerProofDigest,
      },
    },
  }
}
