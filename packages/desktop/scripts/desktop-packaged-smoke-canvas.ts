function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function assertEmptyPersistedCanvasV2(content: string) {
  let persisted: unknown
  try {
    persisted = JSON.parse(content)
  } catch (error) {
    throw new Error("Packaged Canvas persistence is invalid JSON", { cause: error })
  }
  if (!isRecord(persisted) || persisted.schemaVersion !== "convax.canvas/2") {
    throw new Error("Packaged Canvas persistence schema is not convax.canvas/2")
  }
  if (!isRecord(persisted.document) || !Array.isArray(persisted.document.nodes)) {
    throw new Error("Packaged Canvas persistence does not expose document.nodes")
  }
  if (persisted.document.nodes.length !== 0) {
    throw new Error(`Packaged Canvas was not empty: ${JSON.stringify(persisted)}`)
  }
}
