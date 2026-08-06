/**
 * Exact Project-side expectation for the current collaboration protocol. Runtime
 * composition must still compare this tuple with the live module-private authority;
 * these constants never mint protocol authority or provide a fallback decoder.
 */
export const PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION = Object.freeze({
  status: "current-contract-selected" as const,
  requiredProtocolDigest: "8295f918e8f7b8297c080db03672fc410542280f639d9b40a8e324e560f07ae9",
  requiredDomainCount: 129,
  fallbackDecoder: false,
  compatibilityPrimitiveAliases: false,
})
