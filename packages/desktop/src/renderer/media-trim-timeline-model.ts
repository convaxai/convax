export interface MediaTrimRange {
  endSeconds: number
  startSeconds: number
}

export type MediaTrimBoundary = "end" | "start"

const precision = 1_000
export const minimumMediaTrimDurationSeconds = 0.001

export function roundMediaTimelineSeconds(value: number) {
  const rounded = Math.round(value * precision) / precision
  return Object.is(rounded, -0) ? 0 : rounded
}

export function normalizeMediaTimelineDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? roundMediaTimelineSeconds(value) : undefined
}

export function clampMediaTrimRange(range: MediaTrimRange, durationSeconds: number): MediaTrimRange {
  const duration = normalizeMediaTimelineDuration(durationSeconds)
  if (!duration) return { endSeconds: 0, startSeconds: 0 }
  const minimum = Math.min(minimumMediaTrimDurationSeconds, duration)
  const start = clamp(roundMediaTimelineSeconds(range.startSeconds), 0, Math.max(0, duration - minimum))
  const end = clamp(roundMediaTimelineSeconds(range.endSeconds), start + minimum, duration)
  return {
    endSeconds: roundMediaTimelineSeconds(end),
    startSeconds: roundMediaTimelineSeconds(start),
  }
}

export function moveMediaTrimBoundary(
  range: MediaTrimRange,
  durationSeconds: number,
  boundary: MediaTrimBoundary,
  value: number,
): MediaTrimRange {
  const duration = normalizeMediaTimelineDuration(durationSeconds)
  if (!duration) return { endSeconds: 0, startSeconds: 0 }
  const current = clampMediaTrimRange(range, duration)
  const minimum = Math.min(minimumMediaTrimDurationSeconds, duration)
  if (boundary === "start") {
    return {
      ...current,
      startSeconds: roundMediaTimelineSeconds(clamp(value, 0, current.endSeconds - minimum)),
    }
  }
  return {
    ...current,
    endSeconds: roundMediaTimelineSeconds(clamp(value, current.startSeconds + minimum, duration)),
  }
}

export function mediaTrimInputFromRange(range: MediaTrimRange) {
  return {
    durationSeconds: roundMediaTimelineSeconds(range.endSeconds - range.startSeconds),
    startSeconds: roundMediaTimelineSeconds(range.startSeconds),
  }
}

export function mediaTimelineSampleTimes(durationSeconds: number, count: number) {
  const duration = normalizeMediaTimelineDuration(durationSeconds)
  if (!duration || !Number.isSafeInteger(count) || count <= 0) return []
  const finalSeek = Math.max(0, duration - Math.min(0.05, duration / 2))
  return Array.from({ length: count }, (_, index) =>
    roundMediaTimelineSeconds(Math.min(finalSeek, (duration * (index + 0.5)) / count)),
  )
}

export function formatMediaTimelineTime(value: number, includeMilliseconds = false) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0)
  const totalMilliseconds = Math.round(safe * precision)
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000)
  const milliseconds = totalMilliseconds % 1_000
  const clock = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
  return includeMilliseconds ? `${clock}.${String(milliseconds).padStart(3, "0")}` : clock
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum
  return Math.min(Math.max(value, minimum), maximum)
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}
