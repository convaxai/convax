/**
 * Exact Project-side expectation for the current collaboration protocol. Runtime
 * composition must still compare this tuple with the live module-private authority;
 * these constants never mint protocol authority or provide a fallback decoder.
 */
export const PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION = Object.freeze({
  status: "current-contract-selected" as const,
  requiredProtocolDigest: "6a381ca9eedad883c336fcf0874ef6b824236b5fcb99d2f1fee349653334c993",
  requiredDomainCount: 127,
  fallbackDecoder: false,
  compatibilityPrimitiveAliases: false,
})
