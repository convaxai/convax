import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AgentMarkdown, renderAgentMarkdown } from "./agent-markdown"

describe("AgentMarkdown", () => {
  test("renders common Markdown without owning conversation state", () => {
    const markup = renderToStaticMarkup(
      <AgentMarkdown text={"## Plan\n\n- **Inspect** the graph\n- Run `bun test`\n\n| Item | State |\n| --- | --- |\n| Agent | Ready |"} />,
    )

    expect(markup).toContain("<h2>Plan</h2>")
    expect(markup).toContain("<strong>Inspect</strong>")
    expect(markup).toContain("<code>bun test</code>")
    expect(markup).toContain("<table>")
  })

  test("renders raw HTML as text and drops unsafe link targets", () => {
    const html = renderAgentMarkdown("<script>alert('no')</script>")
    const unsafeLink = renderAgentMarkdown("[open](javascript:malicious)")

    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(unsafeLink).not.toContain("javascript:")
    expect(unsafeLink).not.toContain("href=")
  })
})
