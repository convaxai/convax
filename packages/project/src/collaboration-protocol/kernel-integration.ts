/**
 * Exact Project-side expectation for the active R5 collaboration bundle. Runtime
 * composition must still compare this tuple with the live module-private authority;
 * these constants never mint protocol authority or provide a fallback decoder.
 */
export const PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2 = Object.freeze({
  status: "r5-contract-selected" as const,
  requiredProtocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5",
  requiredDomainCount: 127,
  fallbackDecoder: false,
  compatibilityPrimitiveAliases: false,
})
