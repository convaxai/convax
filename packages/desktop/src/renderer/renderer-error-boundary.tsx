import { Component, type ErrorInfo, type ReactNode } from "react"

type RendererErrorFallback = (context: { error: Error; retry: () => void }) => ReactNode

export interface RendererErrorBoundaryProps {
  children: ReactNode
  name: string
  onError?: (error: Error, info: ErrorInfo) => void
  renderFallback: RendererErrorFallback
  resetKey?: number | string
}

interface RendererErrorBoundaryState {
  error: Error | null
  resetKey: number | string | undefined
}

function normalizeRendererError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value))
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  constructor(props: RendererErrorBoundaryProps) {
    super(props)
    this.state = { error: null, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: unknown): Partial<RendererErrorBoundaryState> {
    return { error: normalizeRendererError(error) }
  }

  static getDerivedStateFromProps(
    props: RendererErrorBoundaryProps,
    state: RendererErrorBoundaryState,
  ): Partial<RendererErrorBoundaryState> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null
    return { error: null, resetKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.onError) {
      this.props.onError(error, info)
      return
    }
    console.error(`[convax] ${this.props.name} renderer failed`, error, info.componentStack)
  }

  private retry = () => {
    this.setState((state) => (state.error ? { error: null } : null))
  }

  render() {
    if (!this.state.error) return this.props.children
    return this.props.renderFallback({ error: this.state.error, retry: this.retry })
  }
}
