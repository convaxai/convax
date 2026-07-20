import { Button, Input } from "@convax/ui"
import { Crop, ImageDown, LoaderCircle, Scissors, X } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react"
import type { AppLocale } from "./app-language"
import {
  type FfmpegTransformDialogRequest,
  type FfmpegTransformInput,
  type FfmpegTransformKind,
  validateFfmpegTransformInput,
} from "./ffmpeg-selection-action"

export interface FfmpegTransformDialogProps {
  locale: AppLocale
  onClose: () => void
  onConfirm: (input: FfmpegTransformInput, signal: AbortSignal) => Promise<void>
  request: FfmpegTransformDialogRequest
}

interface DialogCopy {
  cancel: string
  cropHelp: string
  durationSeconds: string
  errors: Readonly<Record<string, string>>
  extractDescription: string
  extractTitle: string
  height: string
  processing: string
  run: string
  startSeconds: string
  timeSeconds: string
  trimDescription: string
  trimTitle: string
  width: string
  x: string
  y: string
  cropDescription: string
  cropTitle: string
}

const englishCopy: DialogCopy = {
  cancel: "Cancel",
  cropDescription: "Create a new MP4 node from a rectangular area of the selected video.",
  cropHelp: "Position, width, and height must be even pixel values for accurate YUV 4:2:0 cropping.",
  cropTitle: "Crop video",
  durationSeconds: "Duration (seconds)",
  errors: {},
  extractDescription: "Create a PNG node from one point in the selected video.",
  extractTitle: "Extract frame",
  height: "Height",
  processing: "Processing…",
  run: "Create result",
  startSeconds: "Start (seconds)",
  timeSeconds: "Time (seconds)",
  trimDescription: "Create a new MP4 node from a time range in the selected video.",
  trimTitle: "Trim video",
  width: "Width",
  x: "X",
  y: "Y",
}

const chineseCopy: DialogCopy = {
  cancel: "取消",
  cropDescription: "从所选视频的矩形区域创建一个新的 MP4 节点。",
  cropHelp: "为保证 YUV 4:2:0 裁剪位置准确，坐标、宽度和高度都必须是偶数。",
  cropTitle: "裁剪视频",
  durationSeconds: "时长（秒）",
  errors: {
    "Crop position must use non-negative even pixel values.": "裁剪位置必须使用不小于 0 的偶数像素。",
    "Crop width and height must be positive even pixel values.": "裁剪宽度和高度必须是大于 0 的偶数像素。",
    "Duration must be greater than zero.": "时长必须大于 0。",
    "Frame time must be zero or a positive number.": "抽帧时间必须是不小于 0 的数字。",
    "Start time must be zero or a positive number.": "开始时间必须是不小于 0 的数字。",
  },
  extractDescription: "从所选视频的指定时间点创建一个新的 PNG 节点。",
  extractTitle: "抽帧",
  height: "高度",
  processing: "处理中…",
  run: "创建结果",
  startSeconds: "开始时间（秒）",
  timeSeconds: "时间点（秒）",
  trimDescription: "从所选视频的指定时间范围创建一个新的 MP4 节点。",
  trimTitle: "截取视频",
  width: "宽度",
  x: "横坐标",
  y: "纵坐标",
}

export function ffmpegTransformLabel(locale: AppLocale, kind: FfmpegTransformKind) {
  const copy = locale === "zh-CN" ? chineseCopy : englishCopy
  if (kind === "extract-frame") return copy.extractTitle
  if (kind === "trim") return copy.trimTitle
  return copy.cropTitle
}

export function shouldCloseFfmpegDialogAfterFailure(contextSignal: AbortSignal, operationSignal: AbortSignal) {
  return contextSignal.aborted || operationSignal.aborted
}

export function FfmpegTransformDialog(props: FfmpegTransformDialogProps) {
  const copy = props.locale === "zh-CN" ? chineseCopy : englishCopy
  const defaults = defaultValues(props.request)
  const [first, setFirst] = useState(defaults.first)
  const [second, setSecond] = useState(defaults.second)
  const [third, setThird] = useState(defaults.third)
  const [fourth, setFourth] = useState(defaults.fourth)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const operationControllerRef = useRef<AbortController | undefined>(undefined)
  const submittedRef = useRef(false)
  const previousFocusRef = useRef(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )

  const cancelOrClose = useCallback(() => {
    const controller = operationControllerRef.current
    if (controller && !controller.signal.aborted) {
      controller.abort(new DOMException("Canceled", "AbortError"))
      return
    }
    props.onClose()
  }, [props.onClose])

  useEffect(() => {
    const close = () => {
      if (!submittedRef.current) props.onClose()
    }
    const signal = props.request.context.signal
    signal.addEventListener("abort", close, { once: true })
    if (signal.aborted) close()
    return () => signal.removeEventListener("abort", close)
  }, [props.onClose, props.request.context.signal])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      cancelOrClose()
    }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [cancelOrClose])

  useEffect(
    () => {
      return () => {
        operationControllerRef.current?.abort(new DOMException("FFmpeg dialog closed", "AbortError"))
        if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
      }
    },
    [],
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const input = parseInput(props.request.kind, { first, fourth, second, third })
    const validationError = validateFfmpegTransformInput(props.request.kind, input)
    if (validationError) {
      setError(copy.errors[validationError] ?? validationError)
      return
    }
    if (props.request.context.signal.aborted) {
      props.onClose()
      return
    }
    const operationController = new AbortController()
    operationControllerRef.current = operationController
    submittedRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await props.onConfirm(input, operationController.signal)
      props.onClose()
    } catch (failure) {
      if (shouldCloseFfmpegDialogAfterFailure(props.request.context.signal, operationController.signal)) {
        props.onClose()
        return
      }
      operationControllerRef.current = undefined
      submittedRef.current = false
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  const title = ffmpegTransformLabel(props.locale, props.request.kind)
  const description =
    props.request.kind === "extract-frame"
      ? copy.extractDescription
      : props.request.kind === "trim"
        ? copy.trimDescription
        : copy.cropDescription
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-foreground/25 p-4 backdrop-blur-[2px]"
      data-canvas-shortcuts="ignore"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) props.onClose()
      }}
      role="presentation"
    >
      <section
        aria-labelledby="ffmpeg-transform-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              {props.request.kind === "extract-frame" ? (
                <ImageDown className="size-4" />
              ) : props.request.kind === "trim" ? (
                <Scissors className="size-4" />
              ) : (
                <Crop className="size-4" />
              )}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold" id="ffmpeg-transform-title">
                {title}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          </div>
          <Button aria-label={copy.cancel} onClick={cancelOrClose} size="icon-sm" type="button" variant="ghost">
            <X />
          </Button>
        </header>

        <form className="mt-5" onSubmit={(event) => void submit(event)}>
          {props.request.kind === "extract-frame" ? (
            <NumberField
              autoFocus
              disabled={busy}
              label={copy.timeSeconds}
              min={0}
              onChange={setFirst}
              step="0.001"
              value={first}
            />
          ) : props.request.kind === "trim" ? (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                autoFocus
                disabled={busy}
                label={copy.startSeconds}
                min={0}
                onChange={setFirst}
                step="0.001"
                value={first}
              />
              <NumberField
                disabled={busy}
                label={copy.durationSeconds}
                min={0.001}
                onChange={setSecond}
                step="0.001"
                value={second}
              />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  autoFocus
                  disabled={busy}
                  label={copy.x}
                  min={0}
                  onChange={setFirst}
                  step="2"
                  value={first}
                />
                <NumberField disabled={busy} label={copy.y} min={0} onChange={setSecond} step="2" value={second} />
                <NumberField disabled={busy} label={copy.width} min={2} onChange={setThird} step="2" value={third} />
                <NumberField disabled={busy} label={copy.height} min={2} onChange={setFourth} step="2" value={fourth} />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{copy.cropHelp}</p>
            </>
          )}

          {error ? (
            <p
              className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={cancelOrClose} size="sm" type="button" variant="ghost">
              {copy.cancel}
            </Button>
            <Button disabled={busy} size="sm" type="submit">
              {busy ? <LoaderCircle className="animate-spin" /> : null}
              {busy ? copy.processing : copy.run}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

function NumberField(props: {
  autoFocus?: boolean
  disabled: boolean
  label: string
  min: number
  onChange: (value: string) => void
  step: string
  value: string
}) {
  const id = useId()
  return (
    <label className="block text-xs font-medium" htmlFor={id}>
      <span className="mb-1.5 block">{props.label}</span>
      <Input
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        id={id}
        inputMode="decimal"
        min={props.min}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        step={props.step}
        type="number"
        value={props.value}
      />
    </label>
  )
}

function defaultValues(request: FfmpegTransformDialogRequest) {
  const data = request.context.selectedNodes[0]?.data
  const durationSeconds =
    typeof data?.durationMs === "number" && data.durationMs > 0 ? Math.min(data.durationMs / 1_000, 5) : 5
  const width = evenDimension(data?.width, 1_280)
  const height = evenDimension(data?.height, 720)
  if (request.kind === "extract-frame") return { first: "0", fourth: "", second: "", third: "" }
  if (request.kind === "trim") {
    return { first: "0", fourth: "", second: String(Number(durationSeconds.toFixed(3))), third: "" }
  }
  return { first: "0", fourth: String(height), second: "0", third: String(width) }
}

function parseInput(
  kind: FfmpegTransformKind,
  values: { first: string; fourth: string; second: string; third: string },
): FfmpegTransformInput {
  if (kind === "extract-frame") return { timeSeconds: parseNumber(values.first) }
  if (kind === "trim") {
    return { durationSeconds: parseNumber(values.second), startSeconds: parseNumber(values.first) }
  }
  return {
    height: parseNumber(values.fourth),
    width: parseNumber(values.third),
    x: parseNumber(values.first),
    y: parseNumber(values.second),
  }
}

function parseNumber(value: string) {
  return value.trim() ? Number(value) : Number.NaN
}

function evenDimension(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 2) return fallback
  return Math.max(2, Math.floor(value / 2) * 2)
}
