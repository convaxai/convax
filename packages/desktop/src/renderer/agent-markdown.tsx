import { marked, Renderer } from "marked"
import { useMemo } from "react"

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!)
}

function safeMarkdownUrl(value: string) {
  const href = value.trim()
  if (/^(#|\/|\.\.?\/)/.test(href)) return href
  try {
    const protocol = new URL(href).protocol
    return ["http:", "https:", "mailto:"].includes(protocol) ? href : undefined
  } catch {
    return undefined
  }
}

export function renderAgentMarkdown(source: string) {
  const renderer = new Renderer()
  renderer.html = ({ text }) => escapeHtml(text)
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens)
    const safeHref = safeMarkdownUrl(href)
    if (!safeHref) return label
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ""
    return `<a href="${escapeHtml(safeHref)}"${titleAttribute} rel="noreferrer" target="_blank">${label}</a>`
  }
  renderer.image = ({ href, title, text }) => {
    const safeHref = safeMarkdownUrl(href)
    if (!safeHref || !/^https?:/i.test(safeHref)) return escapeHtml(text)
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ""
    return `<img alt="${escapeHtml(text)}" loading="lazy" src="${escapeHtml(safeHref)}"${titleAttribute}>`
  }
  return marked.parse(source, { async: false, breaks: true, gfm: true, renderer })
}

export function AgentMarkdown({ text }: { text: string }) {
  const html = useMemo(() => renderAgentMarkdown(text), [text])
  return <div className="agent-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
