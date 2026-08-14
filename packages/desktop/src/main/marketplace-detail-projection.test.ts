import { expect, test } from "bun:test"
import { sha256Hex, type SourceKey, type SourceQualifiedItem } from "@convax/marketplace"

import {
  projectMarketplaceCapabilityDetails,
  projectVerifiedMarketplaceShowcase,
  unpackVerifiedMarketplaceArtifact,
} from "./marketplace-detail-projection"

function skill(): SourceQualifiedItem {
  return {
    catalogRevision: "c".repeat(64),
    catalogSequence: 1,
    compatibility: { convax: "*" },
    delivery: {
      kind: "artifact",
      sha256: "a".repeat(64),
      size: 10,
      url: "https://github.com/acme/extensions/releases/download/skill-review-v1.0.0/skill.zip",
    },
    id: "review",
    kind: "skill",
    marketplaceId: "acme",
    official: false,
    presentation: { description: "Review files", name: "Review" },
    runtimeSurface: "none",
    sourceKey: "b".repeat(64) as SourceKey,
    sourceKind: "network",
    sourceOrder: 1,
    version: "1.0.0",
  }
}

test("projects bounded Skill files and an immutable Showcase poster together", async () => {
  const poster = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const projected = await projectMarketplaceCapabilityDetails(skill(), {
    readShowcase: async () => ({
      asset: {
        alt: "Review workflow",
        mime: "image/png",
        sha256: sha256Hex(poster),
        size: poster.byteLength,
        url: "https://github.com/acme/extensions/releases/download/showcase-v1/poster.png",
      },
      bytes: poster,
    }),
    readSkillFiles: async () => ({
      "SKILL.md": new TextEncoder().encode("# Review"),
      "references/guide.md": new TextEncoder().encode("# Guide"),
    }),
  })

  expect(projected.files).toEqual([
    { content: "# Guide", kind: "text", path: "references/guide.md", size: 7 },
    { content: "# Review", kind: "text", path: "SKILL.md", size: 8 },
  ])
  expect(projected.showcase).toMatchObject({ altText: "Review workflow", mimeType: "image/png", size: 11 })
})

test("keeps details available when optional Showcase bytes fail immutable validation", async () => {
  await expect(
    projectMarketplaceCapabilityDetails(skill(), {
      readShowcase: async () => ({
        asset: {
          mime: "image/png",
          sha256: "0".repeat(64),
          size: 8,
          url: "https://github.com/acme/extensions/releases/download/showcase-v1/poster.png",
        },
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
      readSkillFiles: async () => ({ "SKILL.md": new TextEncoder().encode("# Review") }),
    }),
  ).resolves.toMatchObject({ files: [{ path: "SKILL.md" }] })
})

test("rejects mismatched package and active-media signatures", () => {
  const item = skill()
  expect(() => unpackVerifiedMarketplaceArtifact(item, new Uint8Array(10))).toThrow("immutable identity")
  expect(() =>
    projectVerifiedMarketplaceShowcase({
      asset: {
        mime: "image/png",
        sha256: sha256Hex(new Uint8Array(8)),
        size: 8,
        url: "https://github.com/acme/extensions/releases/download/showcase-v1/poster.png",
      },
      bytes: new Uint8Array(8),
    }),
  ).toThrow("immutable identity")
})
