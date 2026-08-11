export interface CutoutTransitionImage {
  readonly complete: boolean
  decode?: () => Promise<void>
  readonly naturalWidth: number
}

export interface CutoutTransitionFrameScheduler {
  cancelFrame(frameId: number): void
  requestFrame(callback: FrameRequestCallback): number
}

function isDecodedCutoutImage(image: CutoutTransitionImage) {
  return image.complete && image.naturalWidth > 0
}

async function waitForCutoutImageDecode(image: CutoutTransitionImage) {
  if (!isDecodedCutoutImage(image)) return false
  try {
    await image.decode?.()
  } catch {
    // A loaded image can reject decode() after its decoded data was evicted.
    // Recheck the element instead of stranding an otherwise usable transition.
  }
  return isDecodedCutoutImage(image)
}

export function scheduleCutoutTransitionAfterPaint(input: {
  onReady: () => void
  resultImage: CutoutTransitionImage
  scheduler?: CutoutTransitionFrameScheduler
  sourceImage: CutoutTransitionImage
}) {
  const scheduler =
    input.scheduler ??
    ({
      cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
      requestFrame: (callback) => window.requestAnimationFrame(callback),
    } satisfies CutoutTransitionFrameScheduler)
  let cancelled = false
  let firstFrame = 0
  let secondFrame = 0

  void Promise.all([waitForCutoutImageDecode(input.sourceImage), waitForCutoutImageDecode(input.resultImage)]).then(
    ([sourceReady, resultReady]) => {
      if (cancelled || !sourceReady || !resultReady) return
      firstFrame = scheduler.requestFrame(() => {
        if (cancelled) return
        // requestAnimationFrame runs before paint. Keep the already-mounted source
        // layer visible for this frame so the decoded result is first composited
        // behind it, then begin the dissolve on the following frame.
        secondFrame = scheduler.requestFrame(() => {
          if (!cancelled) input.onReady()
        })
      })
    },
  )

  return () => {
    cancelled = true
    if (firstFrame) scheduler.cancelFrame(firstFrame)
    if (secondFrame) scheduler.cancelFrame(secondFrame)
  }
}
