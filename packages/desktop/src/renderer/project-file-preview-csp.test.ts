import { expect, test } from "bun:test"
import fs from "node:fs/promises"

import { projectFilePreviewScheme } from "../project-file-preview-contracts"

test("admits Project file previews only as renderer image and media sources", async () => {
  const html = await fs.readFile(new URL("./index.html", import.meta.url), "utf8")
  const policy = html.match(/content="([^"]*default-src[^"]*)"/)?.[1]
  if (!policy) throw new Error("Desktop renderer Content Security Policy is missing")

  const directives = new Map<string, string[]>()
  for (const directive of policy.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/)
    if (name) directives.set(name, sources)
  }
  const previewSource = `${projectFilePreviewScheme}:`

  expect(directives.get("img-src")).toContain(previewSource)
  expect(directives.get("media-src")).toContain(previewSource)
  for (const [name, sources] of directives) {
    if (name === "img-src" || name === "media-src") continue
    expect(sources).not.toContain(previewSource)
  }
})
