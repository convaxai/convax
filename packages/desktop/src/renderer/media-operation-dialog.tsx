import { Button, Input } from "@convax/ui"
import { AudioLines, Crop, FileText, ImageDown, LoaderCircle, Scissors, Video, X } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react"
import type { AppLocale } from "./app-language"
import { MediaCropEditor } from "./media-crop-editor"
import {
  localizedMediaOperationText,
  type MediaOperationDialogRequest,
  type MediaOperationEditor,
  type MediaOperationInput,
  validateMediaOperationInput,
} from "./media-operation-selection-action"
import { MediaTrimTimeline } from "./media-trim-timeline"
import { mediaTrimInputFromRange, normalizeMediaTimelineDuration } from "./media-trim-timeline-model"

export interface MediaOperationDialogProps {
  locale: AppLocale
  onClose: () => void
  onConfirm: (input: MediaOperationInput, signal: AbortSignal) => Promise<void>
  request: MediaOperationDialogRequest
}

interface DialogCopy {
  cancel: string
  cropDimensions: string
  cropHelp: string
  cropPreviewUnavailable: string
  cropSelection: string
  endSeconds: string
  errors: Readonly<Record<string, string>>
  multiStepHelp: string
  processing: string
  previewLoading: string
  previewUnavailable: string
  run: string
  selectedDuration: string
  startSeconds: string
  timeSeconds: string
}

const englishCopy: DialogCopy = {
  cancel: "Cancel",
  cropDimensions: "Output",
  cropHelp: "Drag the frame to move it, then drag an edge or corner to resize the crop.",
  cropPreviewUnavailable: "Video preview unavailable. The crop frame still uses the source dimensions.",
  cropSelection: "Video crop selection",
  endSeconds: "End (seconds)",
  errors: {},
  multiStepHelp:
    "Every result is connected to the source. Later results are also linked to the results created before them.",
  processing: "Processing…",
  previewLoading: "Loading video…",
  previewUnavailable: "Preview unavailable — drag the timeline handles to choose a range.",
  run: "Create result",
  selectedDuration: "Selected",
  startSeconds: "Start (seconds)",
  timeSeconds: "Time (seconds)",
}

const chineseCopy: DialogCopy = {
  cancel: "取消",
  cropDimensions: "输出尺寸",
  cropHelp: "拖动画面中的选框调整位置，拖拽边缘或四角调整裁剪范围。",
  cropPreviewUnavailable: "暂时无法显示视频预览，裁剪框仍会按照源视频尺寸工作。",
  cropSelection: "视频裁剪选框",
  endSeconds: "结束时间（秒）",
  errors: {
    "Crop area cannot exceed the video dimensions.": "裁剪范围不能超出视频画面。",
    "Crop position must use non-negative even pixel values.": "裁剪位置必须使用不小于 0 的偶数像素。",
    "Crop width and height must be positive even pixel values.": "裁剪宽度和高度必须是大于 0 的偶数像素。",
    "Duration must be greater than zero.": "时长必须大于 0。",
    "Frame time must be zero or a positive number.": "抽帧时间必须是不小于 0 的数字。",
    "Start time must be zero or a positive number.": "开始时间必须是不小于 0 的数字。",
    "Trim end time cannot exceed the video duration.": "结束时间不能超过视频总时长。",
  },
  multiStepHelp: "每个结果都会关联源视频；后续结果还会与此前已创建的结果建立关联。",
  processing: "处理中…",
  previewLoading: "正在读取视频…",
  previewUnavailable: "暂时无法显示缩略图，可继续拖动时间轨两端选择范围。",
  run: "创建结果",
  selectedDuration: "已选时长",
  startSeconds: "开始时间（秒）",
  timeSeconds: "时间点（秒）",
}

export function shouldCloseMediaDialogAfterFailure(contextSignal: AbortSignal, operationSignal: AbortSignal) {
  return operationSignal.aborted || contextSignal.aborted
}

export function MediaOperationDialog(props: MediaOperationDialogProps) {
  const copy = props.locale === "zh-CN" ? chineseCopy : englishCopy
  const editor = props.request.action.editor
  const defaults = defaultValues(props.request)
  const selectedVideo = props.request.context.selectedNodes[0]
  const durationHintMs = selectedVideo && "durationMs" in selectedVideo.data ? selectedVideo.data.durationMs : undefined
  const durationHintSeconds = normalizeMediaTimelineDuration(
    typeof durationHintMs === "number" ? durationHintMs / 1_000 : undefined,
  )
  const resourceState = selectedVideo?.data.resourceState
  const sourceUrl =
    resourceState !== null &&
    typeof resourceState === "object" &&
    "status" in resourceState &&
    resourceState.status === "ready" &&
    "url" in resourceState &&
    typeof resourceState.url === "string"
      ? resourceState.url
      : ""
  const sourceWidth = evenDimension(selectedVideo?.data.width, 1_280)
  const sourceHeight = evenDimension(selectedVideo?.data.height, 720)
  const [first, setFirst] = useState(defaults.first)
  const [second, setSecond] = useState(defaults.second)
  const [third, setThird] = useState(defaults.third)
  const [fourth, setFourth] = useState(defaults.fourth)
  const [trimDurationSeconds, setTrimDurationSeconds] = useState(durationHintSeconds)
  const [cropSourceDimensions, setCropSourceDimensions] = useState({ height: sourceHeight, width: sourceWidth })
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

  useEffect(() => {
    return () => {
      operationControllerRef.current?.abort(new DOMException("Media operation dialog closed", "AbortError"))
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || submittedRef.current) return
    const input = parseInput(editor, { first, fourth, second, third })
    const validationError = validateMediaOperationInput(editor, input, {
      videoHeight: cropSourceDimensions.height,
      videoWidth: cropSourceDimensions.width,
      videoDurationSeconds: trimDurationSeconds,
    })
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
      if (shouldCloseMediaDialogAfterFailure(props.request.context.signal, operationController.signal)) {
        props.onClose()
        return
      }
      operationControllerRef.current = undefined
      submittedRef.current = false
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  const title = localizedMediaOperationText(props.request.action.title, props.locale, props.request.action.i18n)
  const description = localizedMediaOperationText(
    props.request.action.description,
    props.locale,
    props.request.action.i18n,
  )
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
        aria-labelledby="media-transform-title"
        aria-modal="true"
        className={`w-full rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl ${editor === "time-range" || editor === "crop-region" ? "max-w-4xl" : "max-w-md"}`}
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              {editor === "time-point" ? (
                <ImageDown className="size-4" />
              ) : editor === "confirmation" ? (
                <AudioLines className="size-4" />
              ) : editor === "time-range" ? (
                <Scissors className="size-4" />
              ) : (
                <Crop className="size-4" />
              )}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold" id="media-transform-title">
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
          {editor === "time-point" ? (
            <NumberField
              autoFocus
              disabled={busy}
              label={copy.timeSeconds}
              min={0}
              onChange={setFirst}
              step="0.001"
              value={first}
            />
          ) : editor === "confirmation" ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                {props.request.action.steps.map((step, index) => (
                  <div
                    className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/75 px-3 py-2.5"
                    key={`${step.toolId}:${index}`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      {outputIcon(step.output)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{outputLabel(step.output, props.locale)}</span>
                      <span className="block text-[11px] uppercase text-muted-foreground">{step.output}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 leading-5 text-muted-foreground">{copy.multiStepHelp}</p>
            </div>
          ) : editor === "time-range" ? (
            <MediaTrimTimeline
              copy={{
                end: copy.endSeconds,
                loading: copy.previewLoading,
                previewUnavailable: copy.previewUnavailable,
                selectedDuration: copy.selectedDuration,
                start: copy.startSeconds,
              }}
              disabled={busy}
              durationHintSeconds={durationHintSeconds}
              endSeconds={parseNumber(second)}
              label={selectedVideo?.data.label ?? title}
              onChange={(range) => {
                setFirst(String(range.startSeconds))
                setSecond(String(range.endSeconds))
              }}
              onDurationChange={setTrimDurationSeconds}
              sourceUrl={sourceUrl}
              startSeconds={parseNumber(first)}
            />
          ) : (
            <MediaCropEditor
              copy={{
                adjust: copy.cropHelp,
                dimensions: copy.cropDimensions,
                previewUnavailable: copy.cropPreviewUnavailable,
                selection: copy.cropSelection,
              }}
              disabled={busy}
              label={selectedVideo?.data.label ?? title}
              onChange={(rect) => {
                setFirst(String(rect.x))
                setSecond(String(rect.y))
                setThird(String(rect.width))
                setFourth(String(rect.height))
              }}
              onSourceDimensionsChange={setCropSourceDimensions}
              sourceHeight={sourceHeight}
              sourceUrl={sourceUrl}
              sourceWidth={sourceWidth}
              value={{
                height: parseNumber(fourth),
                width: parseNumber(third),
                x: parseNumber(first),
                y: parseNumber(second),
              }}
            />
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
              {busy
                ? copy.processing
                : props.request.action.steps.length > 1
                  ? props.locale === "zh-CN"
                    ? `创建 ${props.request.action.steps.length} 个结果`
                    : `Create ${props.request.action.steps.length} results`
                  : copy.run}
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
  onBlur?: () => void
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
        onBlur={props.onBlur}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        step={props.step}
        type="number"
        value={props.value}
      />
    </label>
  )
}

function defaultValues(request: MediaOperationDialogRequest) {
  const data = request.context.selectedNodes[0]?.data
  const durationSeconds = typeof data?.durationMs === "number" && data.durationMs > 0 ? data.durationMs / 1_000 : 5
  const width = evenDimension(data?.width, 1_280)
  const height = evenDimension(data?.height, 720)
  if (request.action.editor === "time-point") return { first: "0", fourth: "", second: "", third: "" }
  if (request.action.editor === "confirmation" || request.action.editor === "immediate") {
    return { first: "", fourth: "", second: "", third: "" }
  }
  if (request.action.editor === "time-range") {
    return { first: "0", fourth: "", second: String(Number(durationSeconds.toFixed(3))), third: "" }
  }
  return { first: "0", fourth: String(height), second: "0", third: String(width) }
}

function parseInput(
  editor: MediaOperationEditor,
  values: { first: string; fourth: string; second: string; third: string },
): MediaOperationInput {
  if (editor === "time-point") return { timeSeconds: parseNumber(values.first) }
  if (editor === "confirmation" || editor === "immediate") return {}
  if (editor === "time-range") {
    return mediaTrimInputFromRange({
      endSeconds: parseNumber(values.second),
      startSeconds: parseNumber(values.first),
    })
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

function outputLabel(output: "audio" | "image" | "text" | "video", locale: AppLocale) {
  if (locale === "zh-CN") {
    if (output === "audio") return "音频结果"
    if (output === "image") return "图片结果"
    if (output === "video") return "视频结果"
    return "文本结果"
  }
  return `${output[0]?.toLocaleUpperCase()}${output.slice(1)} result`
}

function outputIcon(output: "audio" | "image" | "text" | "video") {
  if (output === "video") return <Video className="size-4" />
  if (output === "image") return <ImageDown className="size-4" />
  if (output === "text") return <FileText className="size-4" />
  return <AudioLines className="size-4" />
}

function evenDimension(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 2) return fallback
  return Math.max(2, Math.floor(value / 2) * 2)
}
