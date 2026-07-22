import { Component, type ErrorInfo, type ReactNode } from "react"

export interface FileRendererBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: unknown, info: ErrorInfo) => void
  renderer?: unknown
}

export interface FileRendererBoundaryState {
  failed: boolean
  renderer: unknown
}

export class FileRendererBoundary extends Component<FileRendererBoundaryProps, FileRendererBoundaryState> {
  state: FileRendererBoundaryState = { failed: false, renderer: this.props.renderer }

  static getDerivedStateFromProps(
    props: FileRendererBoundaryProps,
    state: FileRendererBoundaryState,
  ): FileRendererBoundaryState | null {
    if (Object.is(props.renderer, state.renderer)) return null
    return { failed: false, renderer: props.renderer }
  }

  static getDerivedStateFromError(): Pick<FileRendererBoundaryState, "failed"> {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    try {
      this.props.onError?.(error, info)
    } catch {
      // Diagnostics must not break the renderer fallback.
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return this.props.fallback !== undefined ? (
      this.props.fallback
    ) : (
      <div className="grid size-full place-items-center rounded-lg border border-destructive/40 bg-card p-4 text-center text-sm text-destructive">
        This file renderer failed. Update the file or plugin to retry.
      </div>
    )
  }
}
