import {
  forwardRef,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type FocusEvent,
} from "react"
import {
  BorderBeam,
  type BorderBeamColorVariant,
  type BorderBeamSize,
  type BorderBeamTheme,
} from "border-beam"
import { Button } from "./button"

export type BeamMotion = "idle" | "pulse" | "pulse-inner" | "pulse-outside" | "rotate"
export type BeamTone = "spectrum" | "brand" | "warning"
export type BeamIntensity = "subtle" | "default" | "strong"

interface BeamVisualProps {
  /**
   * Purely visual motion; callers retain ownership of activity semantics.
   * `pulse-outside` exposes the upstream preset unchanged and therefore requires
   * an opaque host with its own border. Inputs should normally use `rotate`.
   */
  beam?: BeamMotion
  /** Semantic palette used to derive the decorative gradient. */
  tone?: BeamTone
  /** Visual strength without changing the host's layout. */
  intensity?: BeamIntensity
  /** Explicit motion override. Omit to follow host and OS preferences. */
  reducedMotion?: boolean
}

type BeamEnvironment = {
  reducedMotion: boolean
  theme: BorderBeamTheme
}

const beamColors: Record<BeamTone, BorderBeamColorVariant> = {
  brand: "ocean",
  spectrum: "colorful",
  warning: "sunset",
}

const beamStrength: Record<BeamIntensity, number> = {
  default: 0.7,
  strong: 1,
  subtle: 0.45,
}

function readBeamEnvironment(): BeamEnvironment {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return { reducedMotion: false, theme: "auto" }
  }
  const root = document.documentElement
  const appTheme = root.getAttribute("data-app-theme")
  const theme: BorderBeamTheme =
    appTheme === "paper" || appTheme === "studio"
      ? "light"
      : appTheme === "graphite" || appTheme === "midnight"
        ? "dark"
        : "auto"
  const motionPreference = root.getAttribute("data-reduced-motion")
  const reducedMotion =
    motionPreference === "true"
      ? true
      : motionPreference === "false"
        ? false
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches
  return { reducedMotion, theme }
}

function useBeamEnvironment(explicitReducedMotion: boolean | undefined) {
  const [environment, setEnvironment] = useState(readBeamEnvironment)

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return () => undefined
    const root = document.documentElement
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => {
      const next = readBeamEnvironment()
      setEnvironment((current) =>
        current.reducedMotion === next.reducedMotion && current.theme === next.theme ? current : next,
      )
    }
    const observer = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(update)
    observer?.observe(root, {
      attributeFilter: ["data-app-theme", "data-reduced-motion"],
      attributes: true,
    })
    media.addEventListener("change", update)
    update()
    return () => {
      observer?.disconnect()
      media.removeEventListener("change", update)
    }
  }, [])

  return {
    reducedMotion: explicitReducedMotion ?? environment.reducedMotion,
    theme: environment.theme,
  }
}

function beamMotionAttribute(reducedMotion: boolean | undefined) {
  if (reducedMotion === true) return "reduce"
  if (reducedMotion === false) return "animate"
  return undefined
}

function beamDataAttributes(
  props: Required<Pick<BeamVisualProps, "beam" | "intensity" | "tone">> & BeamVisualProps,
) {
  return {
    "data-ui-beam": props.beam,
    "data-ui-beam-intensity": props.intensity,
    "data-ui-beam-motion": beamMotionAttribute(props.reducedMotion),
    "data-ui-beam-tone": props.tone,
  } as const
}

function surfaceBeamSize(beam: BeamMotion): BorderBeamSize {
  if (beam === "pulse-outside") return "pulse-outside"
  if (beam === "pulse" || beam === "pulse-inner") return "pulse-inner"
  return "md"
}

function buttonBeamSize(beam: BeamMotion): BorderBeamSize {
  if (beam === "pulse-outside") return "pulse-outside"
  if (beam === "pulse" || beam === "pulse-inner") return "pulse-inner"
  return "sm"
}

export interface BeamSurfaceProps extends ComponentPropsWithoutRef<"div">, BeamVisualProps {
  /** Activates the upstream Large (`md`) preset while focus is within an idle surface. */
  focusBeam?: boolean
}

/**
 * Product-neutral composite surface using the upstream Border Beam geometry.
 * The caller owns input, busy, cancellation, and accessibility semantics.
 */
export const BeamSurface = forwardRef<HTMLDivElement, BeamSurfaceProps>(function BeamSurface(
  {
    beam = "idle",
    children,
    className,
    focusBeam = false,
    intensity = "default",
    onBlurCapture,
    onFocusCapture,
    reducedMotion,
    tone = "spectrum",
    ...props
  },
  ref,
) {
  const [focusWithin, setFocusWithin] = useState(false)
  const environment = useBeamEnvironment(reducedMotion)
  const focusActive = focusBeam && beam === "idle" && focusWithin
  const active = (beam !== "idle" || focusActive) && !environment.reducedMotion
  const size = surfaceBeamSize(beam)

  const handleBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    onBlurCapture?.(event)
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false)
  }
  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    onFocusCapture?.(event)
    setFocusWithin(true)
  }

  return (
    <BorderBeam
      active={active}
      className="ui-beam-root ui-beam-root--surface"
      colorVariant={beamColors[tone]}
      size={size}
      strength={beamStrength[intensity]}
      theme={environment.theme}
    >
      <div
        {...props}
        {...beamDataAttributes({ beam, intensity, reducedMotion, tone })}
        className={className}
        data-slot="beam-surface"
        data-ui-beam-focus={focusBeam ? "" : undefined}
        onBlurCapture={handleBlurCapture}
        onFocusCapture={handleFocusCapture}
        ref={ref}
      >
        {children}
      </div>
    </BorderBeam>
  )
})

export type BeamButtonProps = Omit<ComponentProps<typeof Button>, "ref"> & BeamVisualProps

/** Existing Button behavior with the same decorative beam vocabulary. */
export function BeamButton({
  beam = "idle",
  children,
  intensity = "default",
  reducedMotion,
  tone = "spectrum",
  ...props
}: BeamButtonProps) {
  const environment = useBeamEnvironment(reducedMotion)
  const size = buttonBeamSize(beam)

  return (
    <BorderBeam
      active={beam !== "idle" && !environment.reducedMotion}
      className="ui-beam-root ui-beam-root--button"
      colorVariant={beamColors[tone]}
      size={size}
      strength={beamStrength[intensity]}
      theme={environment.theme}
    >
      <Button
        {...props}
        {...beamDataAttributes({ beam, intensity, reducedMotion, tone })}
        data-slot="beam-button"
      >
        {children}
      </Button>
    </BorderBeam>
  )
}
