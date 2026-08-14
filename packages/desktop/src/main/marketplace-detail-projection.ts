import { sha256Hex, type ShowcaseAsset, type SourceQualifiedItem } from "@convax/marketplace"

import type { MarketplaceCapabilityDetails } from "../marketplace-contracts"
import type { DesktopSkillShowcase } from "../skill-management-contracts"
import { createSkillFilePreviews } from "./skill-details"
import { unpackSafeZip } from "./safe-zip"

export interface MarketplaceShowcaseCandidate {
  asset: ShowcaseAsset
  bytes: Uint8Array
}

export interface MarketplaceDetailProjectionOptions {
  readShowcase(item: SourceQualifiedItem): Promise<MarketplaceShowcaseCandidate | null>
  readSkillFiles(item: SourceQualifiedItem): Promise<Readonly<Record<string, Uint8Array>>>
}

function startsWith(bytes: Uint8Array, expected: readonly number[], offset = 0) {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

function hasExpectedShowcaseSignature(bytes: Uint8Array, mime: ShowcaseAsset["mime"]) {
  if (mime === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (mime === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff])
  if (mime === "image/webp") {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  }
  if (mime === "video/mp4") return startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)
  return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])
}

export function unpackVerifiedMarketplaceArtifact(item: SourceQualifiedItem, bytes: Uint8Array) {
  if (
    (item.delivery.kind !== "artifact" && item.delivery.kind !== "builtin-artifact") ||
    bytes.byteLength !== item.delivery.size ||
    sha256Hex(bytes) !== item.delivery.sha256
  ) {
    throw new Error("Marketplace detail artifact does not match its immutable identity")
  }
  return unpackSafeZip(bytes)
}

export function projectVerifiedMarketplaceShowcase(
  candidate: MarketplaceShowcaseCandidate | null,
): DesktopSkillShowcase | undefined {
  if (!candidate) return undefined
  const { asset, bytes } = candidate
  if (
    bytes.byteLength !== asset.size ||
    sha256Hex(bytes) !== asset.sha256 ||
    !hasExpectedShowcaseSignature(bytes, asset.mime)
  ) {
    throw new Error("Marketplace Showcase media does not match its immutable identity")
  }
  return {
    altText: asset.alt ?? "",
    bytes: Uint8Array.from(bytes),
    mimeType: asset.mime,
    size: bytes.byteLength,
  }
}

export async function projectMarketplaceCapabilityDetails(
  item: SourceQualifiedItem,
  options: MarketplaceDetailProjectionOptions,
): Promise<Pick<MarketplaceCapabilityDetails, "files" | "showcase">> {
  const showcasePromise = options
    .readShowcase(item)
    .then(projectVerifiedMarketplaceShowcase)
    .catch(() => undefined)
  if (item.kind !== "skill") {
    const showcase = await showcasePromise
    return showcase ? { showcase } : {}
  }
  const [files, showcase] = await Promise.all([options.readSkillFiles(item), showcasePromise])
  return {
    files: createSkillFilePreviews(files),
    ...(showcase ? { showcase } : {}),
  }
}
