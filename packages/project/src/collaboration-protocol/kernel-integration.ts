import { currentProtocolDescriptor } from "@convax/collaboration"

/**
 * Exact Project-side expectation for the current collaboration protocol. Runtime
 * composition must still compare this tuple with the live module-private authority;
 * these constants never mint protocol authority or provide a fallback decoder.
 */
const currentProtocol = currentProtocolDescriptor()

export const PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION = Object.freeze({
  status: "current-contract-selected" as const,
  requiredProtocolDigest: currentProtocol.protocolDigest,
  requiredDomainCount: currentProtocol.digestDomains.length,
  fallbackDecoder: false,
  compatibilityPrimitiveAliases: false,
})
