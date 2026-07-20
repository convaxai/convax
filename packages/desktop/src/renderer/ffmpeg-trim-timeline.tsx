import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  clampFfmpegTrimRange,
  ffmpegTimelineSampleTimes,
  formatFfmpegTimelineTime,
  moveFfmpegTrimBoundary,
  normalizeFfmpegTimelineDuration,
  type FfmpegTrimBoundary,
  type FfmpegTrimRange,
} from "./ffmpeg-trim-timeline-model"

interface FfmpegTrimTimelineCopy {
  end: string
  loading: string
  previewUnavailable: string
  selectedDuration: string
  start: string
}

export interface FfmpegTrimTimelineProps {
  copy: FfmpegTrimTimelineCopy
  disabled: boolean
  durationHintSeconds?: number
  endSeconds: number
  label: string
  onChange: (range: FfmpegTrimRange) => void
  onDurationChange?: (durationSeconds: number) => void
  sourceUrl: string
  startSeconds: number
}

const thumbnailCount = 12

export function FfmpegTrimTimeline(props: FfmpegTrimTimelineProps) {
  const hint = normalizeFfmpegTimelineDuration(props.durationHintSeconds)
  const [resolvedDuration, setResolvedDuration] = useState<number>()
  const [previewUnavailable, setPreviewUnavailable] = useState(false)
  const resolvedMetadataRef = useRef(false)
  const duration = resolvedDuration ?? hint
  const range = duration
    ? clampFfmpegTrimRange({ endSeconds: props.endSeconds, startSeconds: props.startSeconds }, duration)
    : { endSeconds: Math.max(props.endSeconds, props.startSeconds), startSeconds: Math.max(0, props.startSeconds) }
  const samples = useMemo(() => (duration ? ffmpegTimelineSampleTimes(duration, thumbnailCount) : []), [duration])
  const startPercent = duration ? (range.startSeconds / duration) * 100 : 0
  const endPercent = duration ? (range.endSeconds / duration) * 100 : 100
  const selectionPercent = Math.max(0, endPercent - startPercent)
  const summaryPercent = Math.min(88, Math.max(12, startPercent + selectionPercent / 2))

  useEffect(() => {
    resolvedMetadataRef.current = false
    setResolvedDuration(undefined)
    setPreviewUnavailable(false)
  }, [props.sourceUrl])

  const resolveDuration = useCallback(
    (candidate: number) => {
      const actual = normalizeFfmpegTimelineDuration(candidate)
      if (!actual) return
      const firstResolution = !resolvedMetadataRef.current
      resolvedMetadataRef.current = true
      setResolvedDuration(actual)
      props.onDurationChange?.(actual)
      setPreviewUnavailable(false)
      const hintWasFullySelected = Boolean(
        hint && Math.abs(props.startSeconds) < 0.001 && Math.abs(props.endSeconds - hint) < 0.01,
      )
      const requested = {
        endSeconds: firstResolution && (!hint || hintWasFullySelected) ? actual : props.endSeconds,
        startSeconds: props.startSeconds,
      }
      const next = clampFfmpegTrimRange(requested, actual)
      if (next.startSeconds !== props.startSeconds || next.endSeconds !== props.endSeconds) props.onChange(next)
    },
    [hint, props.endSeconds, props.onChange, props.onDurationChange, props.startSeconds],
  )

  const changeBoundary = (boundary: FfmpegTrimBoundary, value: number) => {
    if (!duration) return
    props.onChange(moveFfmpegTrimBoundary(range, duration, boundary, value))
  }

  return (
    <div className="min-w-0" data-testid="ffmpeg-trim-timeline">
      <video
        aria-hidden="true"
        className="hidden"
        muted
        onError={() => setPreviewUnavailable(true)}
        onLoadedMetadata={(event) => resolveDuration(event.currentTarget.duration)}
        playsInline
        preload="metadata"
        src={props.sourceUrl}
        tabIndex={-1}
      />

      <div className="relative pt-9">
        <div
          className="absolute top-0 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-[11px] font-semibold tabular-nums text-background shadow-lg"
          style={{ left: `${summaryPercent}%` }}
        >
          {duration
            ? `${formatFfmpegTimelineTime(range.startSeconds, true)} – ${formatFfmpegTimelineTime(range.endSeconds, true)}`
            : props.copy.loading}
        </div>

        <div className="relative h-[92px] overflow-hidden rounded-2xl border border-border bg-foreground/90 shadow-inner">
          <div className="grid size-full grid-cols-12 overflow-hidden">
            {samples.length
              ? samples.map((time, index) => (
                  <FfmpegTimelineThumbnail
                    key={`${index}:${time}`}
                    label={props.label}
                    sourceUrl={props.sourceUrl}
                    timeSeconds={time}
                  />
                ))
              : Array.from({ length: thumbnailCount }, (_, index) => (
                  <span
                    className="animate-pulse border-r border-white/10 bg-gradient-to-br from-white/15 to-white/5 last:border-r-0"
                    key={index}
                  />
                ))}
          </div>

          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-black/65"
            style={{ width: `${startPercent}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 bg-black/65"
            style={{ width: `${100 - endPercent}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 rounded-xl border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_0_20px_rgba(0,0,0,0.35)]"
            style={{ left: `${startPercent}%`, width: `${selectionPercent}%` }}
          />

          {duration ? (
            <>
              <input
                aria-label={props.copy.start}
                aria-valuetext={formatFfmpegTimelineTime(range.startSeconds, true)}
                className="ffmpeg-trim-range absolute inset-0 size-full"
                disabled={props.disabled}
                max={duration}
                min={0}
                onChange={(event) => changeBoundary("start", event.currentTarget.valueAsNumber)}
                step="0.001"
                style={{ zIndex: startPercent > 88 ? 30 : 20 }}
                type="range"
                value={range.startSeconds}
              />
              <input
                aria-label={props.copy.end}
                aria-valuetext={formatFfmpegTimelineTime(range.endSeconds, true)}
                className="ffmpeg-trim-range absolute inset-0 size-full"
                disabled={props.disabled}
                max={duration}
                min={0}
                onChange={(event) => changeBoundary("end", event.currentTarget.valueAsNumber)}
                step="0.001"
                style={{ zIndex: 25 }}
                type="range"
                value={range.endSeconds}
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
        <span>{previewUnavailable ? props.copy.previewUnavailable : props.label}</span>
        <span className="shrink-0 tabular-nums">
          {props.copy.selectedDuration}: {formatFfmpegTimelineTime(range.endSeconds - range.startSeconds, true)}
        </span>
      </div>
    </div>
  )
}

function FfmpegTimelineThumbnail(props: { label: string; sourceUrl: string; timeSeconds: number }) {
  const [ready, setReady] = useState(false)
  return (
    <span className="relative min-w-0 overflow-hidden border-r border-white/15 bg-white/5 last:border-r-0">
      <video
        aria-hidden="true"
        className={`pointer-events-none size-full scale-110 object-cover transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
        draggable={false}
        muted
        onLoadedMetadata={(event) => {
          const maximum = Math.max(0, event.currentTarget.duration - 0.05)
          event.currentTarget.currentTime = Math.min(maximum, props.timeSeconds)
        }}
        onSeeked={() => setReady(true)}
        playsInline
        preload="metadata"
        src={props.sourceUrl}
        tabIndex={-1}
        title={props.label}
      />
    </span>
  )
}
