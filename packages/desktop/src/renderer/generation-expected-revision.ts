export function reconcileGenerationExpectedRevision(requestRevision: number, authoritativeRevision: number) {
  return Math.max(requestRevision, authoritativeRevision)
}
