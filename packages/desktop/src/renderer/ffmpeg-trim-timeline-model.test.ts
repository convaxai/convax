import { describe, expect, test } from "bun:test"
import {
  clampFfmpegTrimRange,
  ffmpegTimelineSampleTimes,
  ffmpegTrimInputFromRange,
  formatFfmpegTimelineTime,
  moveFfmpegTrimBoundary,
  normalizeFfmpegTimelineDuration,
} from "./ffmpeg-trim-timeline-model"

describe("FFmpeg trim timeline model", () => {
  test("clamps both handles to the actual media duration without crossing", () => {
    expect(clampFfmpegTrimRange({ endSeconds: 20, startSeconds: -2 }, 10)).toEqual({
      endSeconds: 10,
      startSeconds: 0,
    })
    expect(moveFfmpegTrimBoundary({ endSeconds: 6, startSeconds: 2 }, 10, "start", 7)).toEqual({
      endSeconds: 6,
      startSeconds: 5.999,
    })
    expect(moveFfmpegTrimBoundary({ endSeconds: 6, startSeconds: 2 }, 10, "end", 1)).toEqual({
      endSeconds: 2.001,
      startSeconds: 2,
    })
  })

  test("turns a start/end selection into the existing trim input without floating point tails", () => {
    expect(ffmpegTrimInputFromRange({ endSeconds: 6.5, startSeconds: 2 })).toEqual({
      durationSeconds: 4.5,
      startSeconds: 2,
    })
    expect(ffmpegTrimInputFromRange({ endSeconds: 0.3, startSeconds: 0.1 })).toEqual({
      durationSeconds: 0.2,
      startSeconds: 0.1,
    })
  })

  test("samples representative frames without seeking to the exact media end", () => {
    const samples = ffmpegTimelineSampleTimes(10, 12)
    expect(samples).toHaveLength(12)
    expect(samples[0]).toBeGreaterThan(0)
    expect(samples.at(-1)).toBeLessThan(10)
    expect(ffmpegTimelineSampleTimes(0, 12)).toEqual([])
    expect(ffmpegTimelineSampleTimes(10, 0)).toEqual([])
  })

  test("normalizes duration hints and formats minute and hour timelines", () => {
    expect(normalizeFfmpegTimelineDuration(Number.NaN)).toBeUndefined()
    expect(normalizeFfmpegTimelineDuration(-1)).toBeUndefined()
    expect(normalizeFfmpegTimelineDuration(10.1236)).toBe(10.124)
    expect(formatFfmpegTimelineTime(65.25, true)).toBe("01:05.250")
    expect(formatFfmpegTimelineTime(3_661)).toBe("01:01:01")
  })
})
