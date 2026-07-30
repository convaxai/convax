export type HttpByteRange = { end: number; start: number } | "unsatisfiable" | null

export function parseSingleHttpByteRange(value: string | null, size: number): HttpByteRange {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) return "unsatisfiable"
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable"
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      return "unsatisfiable"
    }
    end = Math.min(end, size - 1)
  }
  return { end, start }
}
