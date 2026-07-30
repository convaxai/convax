import { createHash } from "node:crypto"

export function canonicalJson(value: unknown): string {
  const visit = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return candidate
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new TypeError("canonical JSON rejects non-finite numbers")
      return Object.is(candidate, -0) ? 0 : candidate
    }
    if (Array.isArray(candidate)) return candidate.map(visit)
    if (typeof candidate === "object") {
      const source = candidate as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(source)
          .sort()
          .map((key) => {
            if (source[key] === undefined) throw new TypeError("canonical JSON rejects undefined")
            return [key, visit(source[key])]
          }),
      )
    }
    throw new TypeError(`canonical JSON rejects ${typeof candidate}`)
  }
  return JSON.stringify(visit(value))
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}
