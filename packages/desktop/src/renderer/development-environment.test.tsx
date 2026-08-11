import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  DevelopmentEnvironmentBadge,
  developmentApplicationTitle,
  rendererDevelopmentIdentity,
} from "./development-environment"

describe("development environment projection", () => {
  test("accepts one bounded identity from the Main-authored renderer URL", () => {
    expect(
      rendererDevelopmentIdentity("http://localhost:5173/?convax-solo-task-id=abc123&convax-solo-task-label=text-drag"),
    ).toEqual({ id: "abc123", label: "text-drag" })
    expect(rendererDevelopmentIdentity("file:///renderer/index.html")).toBeUndefined()
    expect(rendererDevelopmentIdentity("file:///renderer/index.html?convax-solo-task-id=abc123")).toBeUndefined()
    expect(
      rendererDevelopmentIdentity(
        "file:///renderer/index.html?convax-solo-task-id=abc123&convax-solo-task-label=🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀",
      ),
    ).toEqual({ id: "abc123", label: "🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀" })
    expect(
      rendererDevelopmentIdentity(
        "file:///renderer/index.html?convax-solo-task-id=abc123&convax-solo-task-label=开发任务",
      ),
    ).toEqual({ id: "abc123", label: "开发任务" })
    expect(
      rendererDevelopmentIdentity(
        "file:///renderer/index.html?convax-solo-task-id=abc123&convax-solo-task-label=%C2%A0text-drag",
      ),
    ).toBeUndefined()
    expect(
      rendererDevelopmentIdentity(
        "file:///renderer/index.html?convax-solo-task-id=ABC&convax-solo-task-label=text-drag",
      ),
    ).toBeUndefined()
    expect(
      rendererDevelopmentIdentity(
        "file:///renderer/index.html?convax-solo-task-id=abc123&convax-solo-task-id=def456&convax-solo-task-label=text-drag",
      ),
    ).toBeUndefined()
  })

  test("renders a fixed task label instead of relying on product branding", () => {
    const identity = { id: "abc123", label: "text-drag" }
    const markup = renderToStaticMarkup(<DevelopmentEnvironmentBadge identity={identity} />)

    expect(developmentApplicationTitle(identity)).toBe("Convax [text-drag]")
    expect(developmentApplicationTitle()).toBe("Convax")
    expect(markup).toContain('data-development-environment-badge="abc123"')
    expect(markup).toContain("fixed bottom-3 right-3")
    expect(markup).toContain("SOLO")
    expect(markup).toContain("text-drag")
  })
})
