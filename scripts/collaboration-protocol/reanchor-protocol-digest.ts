import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { encodeRestrictedJcs } from "../../packages/collaboration/src/jcs"
import {
  CURRENT_PROTOCOL_IDENTITIES,
  KERNEL_DIGEST_DOMAINS,
  PROTOCOL_DIGEST_DOMAIN_REGISTRY,
  PROTOCOL_SCHEMA_ARTIFACTS,
  PROTOCOL_TYPE_NAMESPACES,
  YJS_WIRE_CODEC,
} from "../../packages/collaboration/src/constants"

function structuredDigest(domain: string, value: unknown): string {
  const domainBytes = new TextEncoder().encode(`${domain}\0`)
  const body = encodeRestrictedJcs(value)
  const bytes = new Uint8Array(domainBytes.byteLength + body.byteLength)
  bytes.set(domainBytes)
  bytes.set(body, domainBytes.byteLength)
  return createHash("sha256").update(bytes).digest("hex")
}

const core = Object.freeze({
  artifacts: PROTOCOL_SCHEMA_ARTIFACTS,
  channelContractDigest: CURRENT_PROTOCOL_IDENTITIES.channelContractDigest,
  domainRegistry: PROTOCOL_DIGEST_DOMAIN_REGISTRY,
  format: "convax.protocol-schema-bundle-core",
  limitsDigest: CURRENT_PROTOCOL_IDENTITIES.limitsDigest,
  protocolMajor: "current",
  typeNamespaces: PROTOCOL_TYPE_NAMESPACES,
  uriProtocolDigest: CURRENT_PROTOCOL_IDENTITIES.uriProtocolDigest,
  yjsWireCodec: YJS_WIRE_CODEC,
})

const protocolDigest = structuredDigest(KERNEL_DIGEST_DOMAINS.protocolSchemaBundleCore, core)
const constantsPath = join(import.meta.dir, "../../packages/collaboration/src/constants.ts")
let text = readFileSync(constantsPath, "utf8")
const updated = text.replace(/protocolDigest:\s*"[a-f0-9]{64}"/, `protocolDigest: "${protocolDigest}"`)
if (updated === text) throw new Error("Could not locate protocolDigest anchor")
writeFileSync(constantsPath, updated)
console.log(`reanchored protocolDigest=${protocolDigest}`)
console.log(
  `sorted=${[...PROTOCOL_DIGEST_DOMAIN_REGISTRY].every((d, i, a) => i === 0 || a[i - 1]! < d)} count=${PROTOCOL_DIGEST_DOMAIN_REGISTRY.length}`,
)
