import { describe, expect, mock, test } from "bun:test"
import type { ErrorInfo } from "react"
import {
  FileRendererBoundary,
  type FileRendererBoundaryProps,
  type FileRendererBoundaryState,
} from "./file-renderer-boundary"

const firstRenderer = () => null
const nextRenderer = () => null
const firstData = { kind: "file", label: "First" }
const nextData = { kind: "file", label: "Updated" }

function props(
  renderer: unknown,
  data = firstData,
  onError?: FileRendererBoundaryProps["onError"],
): FileRendererBoundaryProps {
  return { children: <span>{data.label}</span>, onError, renderer }
}

function failedState(renderer: unknown): FileRendererBoundaryState {
  return {
    failed: true,
    renderer,
  }
}

describe("FileRendererBoundary recovery", () => {
  test("does not retry a failed renderer when only node data gets a new reference", () => {
    expect(
      FileRendererBoundary.getDerivedStateFromProps(props(firstRenderer, nextData), failedState(firstRenderer)),
    ).toBeNull()
  })

  test("recovers when the registered renderer identity changes", () => {
    expect(
      FileRendererBoundary.getDerivedStateFromProps(props(nextRenderer, nextData), failedState(firstRenderer)),
    ).toEqual({ failed: false, renderer: nextRenderer })
  })

  test("reports caught errors without allowing a diagnostic failure to escape", () => {
    const error = new Error("renderer failed")
    const info = { componentStack: "\n    at BrokenRenderer" } as ErrorInfo
    const onError = mock(() => {
      throw new Error("telemetry failed")
    })
    const boundary = new FileRendererBoundary(props(firstRenderer, firstData, onError))

    expect(() => boundary.componentDidCatch(error, info)).not.toThrow()
    expect(onError).toHaveBeenCalledWith(error, info)
  })
})
