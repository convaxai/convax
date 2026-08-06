import { installProtocolAuthority, type CurrentProtocolAuthority } from "./authority"
import { parseDigest, type Digest } from "./codecs"
import {
  CAUSAL_EDIT_MAGIC,
  KERNEL_DIGEST_DOMAINS,
  CURRENT_PROTOCOL_IDENTITIES,
  PROTOCOL_DIGEST_DOMAIN_REGISTRY,
  PROTOCOL_SCHEMA_ARTIFACTS,
  PROTOCOL_TYPE_NAMESPACES,
  YJS_WIRE_CODEC,
} from "./constants"
import { structuredDigest } from "./digest"
import { ProtocolAuthorityError } from "./errors"
import { encodeRestrictedJcs, sameBytes } from "./jcs"

/** File name of the packaged descriptor emitted by the repository generator. */
export const CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME = "current.json"
export const CURRENT_PROTOCOL_DESCRIPTOR_FORMAT = "convax.current-protocol-descriptor" as const

export interface CurrentProtocolArtifactDescriptor {
  readonly name: string
  readonly format: string
  readonly digest: Digest
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
  readonly uriProtocolDigest: Digest
  readonly limitsDigest: Digest
  readonly channelContractDigest: Digest
  readonly yjsWireCodec: CurrentProtocolYjsWireCodecDescriptor
  readonly protocolDigest: Digest
}

const liveDescriptors = new WeakSet<object>()
const installedAuthorities = new WeakMap<object, CurrentProtocolAuthority>()

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
): CurrentProtocolAuthority {
  if (typeof descriptor !== "object" || descriptor === null || !liveDescriptors.has(descriptor)) {
    unavailable("A live current protocol descriptor is required")
  }
  const existing = installedAuthorities.get(descriptor)
  if (existing !== undefined) return existing
  if (builtBundleValue === undefined) build()
  const installed = installProtocolAuthority(builtBundleValue)
  installedAuthorities.set(descriptor, installed)
  return installed
}

function build(): void {
  const core = Object.freeze({
    artifacts: PROTOCOL_SCHEMA_ARTIFACTS,
    channelContractDigest: CURRENT_PROTOCOL_IDENTITIES.channelContractDigest,
    domainRegistry: PROTOCOL_DIGEST_DOMAIN_REGISTRY,
    format: "convax.protocol-schema-bundle-core/2",
    limitsDigest: CURRENT_PROTOCOL_IDENTITIES.limitsDigest,
    protocolMajor: "2",
    typeNamespaces: PROTOCOL_TYPE_NAMESPACES,
    uriProtocolDigest: CURRENT_PROTOCOL_IDENTITIES.uriProtocolDigest,
    yjsWireCodec: YJS_WIRE_CODEC,
  })
  const protocolDigest = structuredDigest(KERNEL_DIGEST_DOMAINS.protocolSchemaBundleCore, core)
  if (protocolDigest !== CURRENT_PROTOCOL_IDENTITIES.protocolDigest) {
    unavailable("The current protocol schema does not reproduce the built protocol digest")
  }
  const descriptor: CurrentProtocolDescriptor = Object.freeze({
    format: CURRENT_PROTOCOL_DESCRIPTOR_FORMAT,
    frameMagic: CAUSAL_EDIT_MAGIC,
    typedIntentFormat: KERNEL_DIGEST_DOMAINS.typedIntent,
    artifacts: Object.freeze(PROTOCOL_SCHEMA_ARTIFACTS.map((artifact) => Object.freeze({
      name: artifact.name,
      format: artifact.format,
      digest: parseDigest(artifact.artifactDigest),
    }))),
    digestDomains: PROTOCOL_DIGEST_DOMAIN_REGISTRY,
    typeNamespaces: PROTOCOL_TYPE_NAMESPACES,
    uriProtocolDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.uriProtocolDigest),
    limitsDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.limitsDigest),
    channelContractDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.channelContractDigest),
    yjsWireCodec: YJS_WIRE_CODEC,
    protocolDigest: parseDigest(protocolDigest),
  })
  const jcs = encodeRestrictedJcs(descriptor)
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
  throw new ProtocolAuthorityError("protocol-schema-bundle-unavailable", message, options)
}
