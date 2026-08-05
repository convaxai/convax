import { installVerifiedProtocolAuthorityV2, type VerifiedProtocolAuthorityV2 } from "./authority"
import { parseDigestV2, type DigestV2 } from "./codecs"
import {
  CAUSAL_EDIT_MAGIC_V2,
  KERNEL_DIGEST_DOMAINS_V2,
  PINNED_AUTHORITY_IDENTITIES_V2,
  PROTOCOL_DIGEST_DOMAIN_REGISTRY_V2,
  PROTOCOL_SCHEMA_ARTIFACTS_V2,
  PROTOCOL_TYPE_NAMESPACES_V2,
  YJS_WIRE_CODEC_V2,
} from "./constants"
import { structuredDigestV2 } from "./digest"
import { ProtocolAuthorityErrorV2 } from "./errors"
import { encodeRestrictedJcsV2, sameBytes } from "./jcs"

/** File name of the packaged descriptor emitted by the repository generator. */
export const CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME = "current.json"
export const CURRENT_PROTOCOL_DESCRIPTOR_FORMAT = "convax.current-protocol-descriptor" as const

export interface CurrentProtocolArtifactDescriptor {
  readonly name: string
  readonly format: string
  readonly digest: DigestV2
}

export interface CurrentProtocolTypeNamespaceDescriptor {
  readonly namespace: string
  readonly imports: readonly string[]
}

export interface CurrentProtocolYjsWireCodecDescriptor {
  readonly applyCodec: string
  readonly format: string
  readonly package: "yjs"
  readonly packageIntegrity: string
  readonly stateVectorCodec: string
  readonly updateCodec: string
  readonly updateVersion: string
  readonly version: string
}

/**
 * The single code-owned description of the collaboration protocol this build
 * implements. It is derived from the owner schema constants, never from an
 * archived authority release, a pointer file, or a directory scan.
 */
export interface CurrentProtocolDescriptor {
  readonly format: typeof CURRENT_PROTOCOL_DESCRIPTOR_FORMAT
  readonly frameMagic: string
  readonly typedIntentFormat: string
  readonly artifacts: readonly CurrentProtocolArtifactDescriptor[]
  readonly digestDomains: readonly string[]
  readonly typeNamespaces: readonly CurrentProtocolTypeNamespaceDescriptor[]
  readonly uriProtocolDigest: DigestV2
  readonly limitsDigest: DigestV2
  readonly channelContractDigest: DigestV2
  readonly yjsWireCodec: CurrentProtocolYjsWireCodecDescriptor
  readonly protocolDigest: DigestV2
}

const liveDescriptors = new WeakSet<object>()
const installedAuthorities = new WeakMap<object, VerifiedProtocolAuthorityV2>()

let builtDescriptor: CurrentProtocolDescriptor | undefined
let builtBundleValue: unknown
let builtBytes: Uint8Array | undefined

/** The descriptor for the protocol compiled into this build. */
export function currentProtocolDescriptor(): CurrentProtocolDescriptor {
  if (builtDescriptor === undefined) build()
  return builtDescriptor!
}

/** Canonical descriptor bytes: restricted JCS plus one trailing LF. */
export function encodeCurrentProtocolDescriptor(): Uint8Array {
  if (builtBytes === undefined) build()
  return Uint8Array.from(builtBytes!)
}

/**
 * Accepts packaged descriptor bytes only when they equal this build's descriptor
 * exactly. A missing, drifted, or contradictory descriptor fails closed; there is
 * no second decoder and no directory-derived fallback.
 */
export function parseCurrentProtocolDescriptor(bytes: Readonly<Uint8Array>): CurrentProtocolDescriptor {
  if (!(bytes instanceof Uint8Array)) unavailable("Current protocol descriptor bytes must be Uint8Array")
  if (!sameBytes(Uint8Array.from(bytes), encodeCurrentProtocolDescriptor())) {
    unavailable("The packaged current protocol descriptor differs from the built descriptor")
  }
  return currentProtocolDescriptor()
}

/**
 * Installs the runtime capability for the current protocol. It accepts only the
 * live descriptor produced by this module, so a structural clone has no authority.
 */
export function installCurrentProtocolAuthority(
  descriptor: CurrentProtocolDescriptor = currentProtocolDescriptor(),
): VerifiedProtocolAuthorityV2 {
  if (typeof descriptor !== "object" || descriptor === null || !liveDescriptors.has(descriptor)) {
    unavailable("A live current protocol descriptor is required")
  }
  const existing = installedAuthorities.get(descriptor)
  if (existing !== undefined) return existing
  if (builtBundleValue === undefined) build()
  const installed = installVerifiedProtocolAuthorityV2(builtBundleValue)
  installedAuthorities.set(descriptor, installed)
  return installed
}

function build(): void {
  const core = Object.freeze({
    artifacts: PROTOCOL_SCHEMA_ARTIFACTS_V2,
    channelContractDigest: PINNED_AUTHORITY_IDENTITIES_V2.channelContractDigest,
    domainRegistry: PROTOCOL_DIGEST_DOMAIN_REGISTRY_V2,
    format: "convax.protocol-schema-bundle-core/2",
    limitsDigest: PINNED_AUTHORITY_IDENTITIES_V2.limitsDigest,
    protocolMajor: "2",
    typeNamespaces: PROTOCOL_TYPE_NAMESPACES_V2,
    uriProtocolDigest: PINNED_AUTHORITY_IDENTITIES_V2.uriProtocolDigest,
    yjsWireCodec: YJS_WIRE_CODEC_V2,
  })
  const protocolDigest = structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.protocolSchemaBundleCore, core)
  if (protocolDigest !== PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest) {
    unavailable("The current protocol schema does not reproduce the built protocol digest")
  }
  const descriptor: CurrentProtocolDescriptor = Object.freeze({
    format: CURRENT_PROTOCOL_DESCRIPTOR_FORMAT,
    frameMagic: CAUSAL_EDIT_MAGIC_V2,
    typedIntentFormat: KERNEL_DIGEST_DOMAINS_V2.typedIntent,
    artifacts: Object.freeze(PROTOCOL_SCHEMA_ARTIFACTS_V2.map((artifact) => Object.freeze({
      name: artifact.name,
      format: artifact.format,
      digest: parseDigestV2(artifact.artifactDigest),
    }))),
    digestDomains: PROTOCOL_DIGEST_DOMAIN_REGISTRY_V2,
    typeNamespaces: PROTOCOL_TYPE_NAMESPACES_V2,
    uriProtocolDigest: parseDigestV2(PINNED_AUTHORITY_IDENTITIES_V2.uriProtocolDigest),
    limitsDigest: parseDigestV2(PINNED_AUTHORITY_IDENTITIES_V2.limitsDigest),
    channelContractDigest: parseDigestV2(PINNED_AUTHORITY_IDENTITIES_V2.channelContractDigest),
    yjsWireCodec: YJS_WIRE_CODEC_V2,
    protocolDigest: parseDigestV2(protocolDigest),
  })
  const jcs = encodeRestrictedJcsV2(descriptor)
  const bytes = new Uint8Array(jcs.byteLength + 1)
  bytes.set(jcs)
  bytes[bytes.length - 1] = 0x0a
  liveDescriptors.add(descriptor)
  builtBundleValue = Object.freeze({
    core,
    coreDigest: protocolDigest,
    format: "convax.protocol-schema-bundle/2",
    protocolDigest,
  })
  builtDescriptor = descriptor
  builtBytes = bytes
}

function unavailable(message: string, options?: ErrorOptions): never {
  throw new ProtocolAuthorityErrorV2("protocol-schema-bundle-unavailable", message, options)
}
