import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { formatWorkspaceMemory, WorkspaceStatusBar } from "./workspace-status-bar"

describe("WorkspaceStatusBar", () => {
  test("renders a thin semantic status surface with stable metrics", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceStatusBar
        client={{ getSnapshot: async () => ({ appCpuPercent: 14, appMemoryBytes: 512 * 1024 * 1024, sampledAt: 1 }) }}
        initialSnapshot={{ appCpuPercent: 14, appMemoryBytes: 512 * 1024 * 1024, sampledAt: 1 }}
        locale="en"
      />,
    )

    expect(markup).toContain('data-workspace-status-bar="true"')
    expect(markup).toContain("CPU")
    expect(markup).toContain("14%")
    expect(markup).toContain("RAM")
    expect(markup).toContain("512 MB")
    expect(markup).toContain('class="flex h-[26px] shrink-0 items-center justify-between')
    expect(markup).not.toContain("Local engine")
    expect(markup).not.toContain("<time")
    expect(markup).not.toContain('class="hidden items-center')
  })

  test("formats bounded memory without exposing raw native units", () => {
    expect(formatWorkspaceMemory(-1)).toBe("0 MB")
    expect(formatWorkspaceMemory(384 * 1024 * 1024)).toBe("384 MB")
    expect(formatWorkspaceMemory(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB")
  })
})
