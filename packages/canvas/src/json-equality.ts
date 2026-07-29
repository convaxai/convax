function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : stableJson(item))).join(",")}]`
  }
  if (isRecord(value)) {
    const record = value
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** Compares the JSON-compatible values admitted by Canvas persistence. */
export function sameCanvasJson(left: unknown, right: unknown) {
  return left === right || stableJson(left) === stableJson(right)
}
