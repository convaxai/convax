export interface FfmpegTrimRange {
  endSeconds: number
  startSeconds: number
}

export type FfmpegTrimBoundary = "end" | "start"

const precision = 1_000
export const minimumFfmpegTrimDurationSeconds = 0.001

export function roundFfmpegTimelineSeconds(value: number) {
  const rounded = Math.round(value * precision) / precision
  return Object.is(rounded, -0) ? 0 : rounded
}

export function normalizeFfmpegTimelineDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? roundFfmpegTimelineSeconds(value)
    : undefined
}

export function clampFfmpegTrimRange(range: FfmpegTrimRange, durationSeconds: number): FfmpegTrimRange {
  const duration = normalizeFfmpegTimelineDuration(durationSeconds)
  if (!duration) return { endSeconds: 0, startSeconds: 0 }
  const minimum = Math.min(minimumFfmpegTrimDurationSeconds, duration)
  const start = clamp(roundFfmpegTimelineSeconds(range.startSeconds), 0, Math.max(0, duration - minimum))
  const end = clamp(roundFfmpegTimelineSeconds(range.endSeconds), start + minimum, duration)
  return {
    endSeconds: roundFfmpegTimelineSeconds(end),
    startSeconds: roundFfmpegTimelineSeconds(start),
  }
}

export function moveFfmpegTrimBoundary(
  range: FfmpegTrimRange,
  durationSeconds: number,
  boundary: FfmpegTrimBoundary,
  value: number,
): FfmpegTrimRange {
  const duration = normalizeFfmpegTimelineDuration(durationSeconds)
  if (!duration) return { endSeconds: 0, startSeconds: 0 }
  const current = clampFfmpegTrimRange(range, duration)
  const minimum = Math.min(minimumFfmpegTrimDurationSeconds, duration)
  if (boundary === "start") {
    return {
      ...current,
      startSeconds: roundFfmpegTimelineSeconds(clamp(value, 0, current.endSeconds - minimum)),
    }
  }
  return {
    ...current,
    endSeconds: roundFfmpegTimelineSeconds(clamp(value, current.startSeconds + minimum, duration)),
  }
}

export function ffmpegTrimInputFromRange(range: FfmpegTrimRange) {
  return {
    durationSeconds: roundFfmpegTimelineSeconds(range.endSeconds - range.startSeconds),
    startSeconds: roundFfmpegTimelineSeconds(range.startSeconds),
  }
}

export function ffmpegTimelineSampleTimes(durationSeconds: number, count: number) {
  const duration = normalizeFfmpegTimelineDuration(durationSeconds)
  if (!duration || !Number.isSafeInteger(count) || count <= 0) return []
  const finalSeek = Math.max(0, duration - Math.min(0.05, duration / 2))
  return Array.from({ length: count }, (_, index) =>
    roundFfmpegTimelineSeconds(Math.min(finalSeek, (duration * (index + 0.5)) / count)),
  )
}

export function formatFfmpegTimelineTime(value: number, includeMilliseconds = false) {
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
