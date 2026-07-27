import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ProjectLocationCapsule } from "./project-location-capsule"

describe("ProjectLocationCapsule", () => {
  test("keeps long Project and Canvas names visually bounded and fully accessible", () => {
    const projectName = "A very long research project that must never expand the Canvas chrome"
    const canvasName = "A very long synthesis Canvas name that remains available to assistive tech"
    const markup = renderToStaticMarkup(
      <ProjectLocationCapsule
        canvasName={canvasName}
        detailsOpen
        onBackToProjects={() => undefined}
        onToggleDetails={() => undefined}
        projectName={projectName}
      />,
    )

    expect(markup).toContain('data-project-location-capsule="true"')
    expect(markup).toContain("max-w-")
    expect(markup).toContain("truncate")
    expect(markup).toContain(`title="${projectName}"`)
    expect(markup).toContain(`title="${canvasName}"`)
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain(`aria-label="Close details for ${projectName}, ${canvasName}"`)
    expect(markup).toContain('aria-label="Back to projects"')
  })

  test("describes a missing active Canvas without inventing selection state", () => {
    const markup = renderToStaticMarkup(
      <ProjectLocationCapsule
        canvasName={null}
        detailsOpen={false}
        onToggleDetails={() => undefined}
        projectName="Atlas"
      />,
    )

    expect(markup).toContain("No canvas")
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('aria-label="Back to projects"')
  })
})
