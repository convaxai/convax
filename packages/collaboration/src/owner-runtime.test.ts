import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { ownerCanonicalizerDescriptorDigest } from "./canonicalizer"
import { parseDigest } from "./codecs"
import { PROTOCOL_SCHEMA_ARTIFACTS } from "./constants"
import type { OwnerProcessValueFactory, SelectedDocumentOwnerArtifactDefinition } from "./contracts"
import { encodeRestrictedJcs } from "./jcs"
import {
  assertDocumentOwnerRuntime,
  assertOwnerExternalFactPort,
  createSelectedDocumentOwnerArtifactFactory,
} from "./owner-runtime"
import { loadVerifiedTestAuthority } from "./authority.test-support"

const SCHEMA = parseDigest(PROTOCOL_SCHEMA_ARTIFACTS[0].artifactDigest)
const descriptor = Object.freeze({
  format: "convax.owner-canonicalizer-descriptor" as const,
  owner: "canvas" as const,
  ownerSchemaDigest: SCHEMA,
  canonicalStateFormat: "convax.canvas-owner-runtime-test",
  canonicalStateCodec: "restricted-jcs-utf8" as const,
  exactBytePolicy: "parse-reencode-byte-equal" as const,
  unknownStatePolicy: "reject" as const,
})
const canonicalizerDigest = ownerCanonicalizerDescriptorDigest(descriptor)

function definition(
  capture?: (values: OwnerProcessValueFactory<"canvas">) => void,
  borrowedValues?: OwnerProcessValueFactory<"canvas">,
): SelectedDocumentOwnerArtifactDefinition<"canvas"> {
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
          canonicalStateBytes: () => encodeRestrictedJcs({ format: descriptor.canonicalStateFormat }),
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

describe("Current document-owner runtime", () => {
  test("mints one live identity closure and rejects structural runtime copies", async () => {
    const authority = await loadVerifiedTestAuthority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
    if ("status" in runtime) throw new Error(runtime.code)
    expect(runtime.artifactDigest).toBe(SCHEMA)
    expect(runtime.closurePort.protocolPort).toBe(runtime.protocolPort)
    expect(() => assertDocumentOwnerRuntime(runtime, authority)).not.toThrow()
    expect(() => assertDocumentOwnerRuntime({ ...runtime }, authority)).toThrow("live selected")
  })

  test("rejects process values borrowed from a different selected factory", async () => {
    const authority = await loadVerifiedTestAuthority()
    let firstValues: OwnerProcessValueFactory<"canvas"> | undefined
    const first = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition((value) => { firstValues = value }))
    if ("status" in first || !firstValues) throw new Error("first runtime unavailable")
    const second = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition(undefined, firstValues))
    if ("status" in second) throw new Error(second.code)
    const document = new Y.Doc()
    try {
      expect(() => second.protocolPort.validateBase(document)).toThrow("another runtime")
    } finally {
      document.destroy()
    }
  })

  test("creates attempt-scoped fact ports and rejects wrong-owner and structural ports", async () => {
    const authority = await loadVerifiedTestAuthority()
    const runtime = createSelectedDocumentOwnerArtifactFactory(authority, "canvas").createRuntime(definition())
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
    expect(() => assertOwnerExternalFactPort(created.port, runtime)).not.toThrow()
    expect(() => assertOwnerExternalFactPort({ ...created.port }, runtime)).toThrow("live owner external-fact")
  })
})
