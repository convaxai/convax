import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { ownerCanonicalizerDescriptorDigestV2 } from "./canonicalizer"
import { parseDigestV2 } from "./codecs"
import { PROTOCOL_SCHEMA_ARTIFACTS_V2 } from "./constants"
import type { OwnerProcessValueFactoryV2, SelectedDocumentOwnerArtifactDefinitionV2 } from "./contracts"
import { encodeRestrictedJcsV2 } from "./jcs"
import {
  assertDocumentOwnerRuntimeV2,
  assertOwnerExternalFactPortV2,
  createSelectedDocumentOwnerArtifactFactoryV2,
} from "./owner-runtime"
import { loadVerifiedTestAuthorityV2 } from "./authority.test-support"

const SCHEMA = parseDigestV2(PROTOCOL_SCHEMA_ARTIFACTS_V2[0].artifactDigest)
const descriptor = Object.freeze({
  format: "convax.owner-canonicalizer-descriptor/2" as const,
  owner: "canvas" as const,
  ownerSchemaDigest: SCHEMA,
  canonicalStateFormat: "convax.canvas-owner-runtime-test/2",
  canonicalStateCodec: "restricted-jcs-utf8" as const,
  exactBytePolicy: "parse-reencode-byte-equal" as const,
  unknownStatePolicy: "reject" as const,
})
const canonicalizerDigest = ownerCanonicalizerDescriptorDigestV2(descriptor)

function definition(
  capture?: (values: OwnerProcessValueFactoryV2<"canvas">) => void,
  borrowedValues?: OwnerProcessValueFactoryV2<"canvas">,
): SelectedDocumentOwnerArtifactDefinitionV2<"canvas"> {
  return {
    owner: "canvas",
    createDefinitions(values) {
      capture?.(values)
      const process = borrowedValues ?? values
      return {
        protocol: {
          owner: "canvas",
          schemaDigest: SCHEMA,
          canonicalizerDescriptor: descriptor,
          canonicalizerDigest,
          decodeIntent: () => ({ kind: "noop" }),
          validateBase: () => process.wrapValidatedState(null),
          applyIntent: () => process.wrapApplyResult(null),
          validatePost: () => process.wrapValidatedState(null),
          canonicalStateBytes: () => encodeRestrictedJcsV2({ format: descriptor.canonicalStateFormat }),
          deriveActualWriteEvidence: () => {
            throw new Error("not used")
          },
        },
        closure: {
          inspectIntent: () => ({ kind: "ordinary" }),
          discoverDependencies: () => ({ validationArtifacts: [], externalFacts: [] }),
          history: null,
        },
      }
    },
  }
}

describe("R5 selected document-owner runtime", () => {
  test("mints one live identity closure and rejects structural runtime copies", async () => {
    const authority = await loadVerifiedTestAuthorityV2()
    const runtime = createSelectedDocumentOwnerArtifactFactoryV2(authority, "canvas").createRuntime(definition())
    if ("status" in runtime) throw new Error(runtime.code)
    expect(runtime.artifactDigest).toBe(SCHEMA)
    expect(runtime.closurePort.protocolPort).toBe(runtime.protocolPort)
    expect(() => assertDocumentOwnerRuntimeV2(runtime, authority)).not.toThrow()
    expect(() => assertDocumentOwnerRuntimeV2({ ...runtime }, authority)).toThrow("live selected")
  })

  test("rejects process values borrowed from a different selected factory", async () => {
    const authority = await loadVerifiedTestAuthorityV2()
    let firstValues: OwnerProcessValueFactoryV2<"canvas"> | undefined
    const first = createSelectedDocumentOwnerArtifactFactoryV2(authority, "canvas").createRuntime(definition((value) => { firstValues = value }))
    if ("status" in first || !firstValues) throw new Error("first runtime unavailable")
    const second = createSelectedDocumentOwnerArtifactFactoryV2(authority, "canvas").createRuntime(definition(undefined, firstValues))
    if ("status" in second) throw new Error(second.code)
    const document = new Y.Doc()
    try {
      expect(() => second.protocolPort.validateBase(document)).toThrow("another runtime")
    } finally {
      document.destroy()
    }
  })

  test("creates attempt-scoped fact ports and rejects wrong-owner and structural ports", async () => {
    const authority = await loadVerifiedTestAuthorityV2()
    const runtime = createSelectedDocumentOwnerArtifactFactoryV2(authority, "canvas").createRuntime(definition())
    if ("status" in runtime) throw new Error(runtime.code)
    const wrongOwner = runtime.externalFactPortFactory.createAttemptPort({
      declared: { validationArtifacts: [], externalFacts: [] },
      resolver: {
        owner: "project-index" as never,
        resolveArtifact: (ref) => ({ status: "pending", ref }),
        resolveFact: (requirement) => ({ status: "pending", requirement }),
      },
    })
    expect(wrongOwner).toEqual({ status: "rejected", code: "wrong-owner" })
    const created = runtime.externalFactPortFactory.createAttemptPort({
      declared: { validationArtifacts: [], externalFacts: [] },
      resolver: {
        owner: "canvas",
        resolveArtifact: (ref) => ({ status: "pending", ref }),
        resolveFact: (requirement) => ({ status: "pending", requirement }),
      },
    })
    if (created.status === "rejected") throw new Error(created.code)
    expect(() => assertOwnerExternalFactPortV2(created.port, runtime)).not.toThrow()
    expect(() => assertOwnerExternalFactPortV2({ ...created.port }, runtime)).toThrow("live owner external-fact")
  })
})
