import {
  equalsProjectUri,
  fromProjectUri,
  parseProjectUri,
  type ConvaxUri,
  type ProjectUriComparison,
} from "@convax/uri"
import { parseProjectEntryId, type ProjectEntryId } from "./identity"

export interface ProjectEntryUriComponents {
  readonly projectId: string
  readonly projectEpoch: string
  readonly entryId: ProjectEntryId
  readonly path?: string
  readonly blob?: `sha256:${string}`
}

export function parseProjectEntryUri(input: ConvaxUri | string): ProjectEntryUriComponents {
  const parsed = parseProjectUri(input)
  return Object.freeze({
    ...parsed,
    entryId: parseProjectEntryId(parsed.entryId),
  })
}

export function fromProjectEntryUri(components: ProjectEntryUriComponents): ConvaxUri {
  parseProjectEntryId(components.entryId)
  return fromProjectUri(components)
}

export function equalsProjectEntryUri(
  left: ConvaxUri | string,
  right: ConvaxUri | string,
  comparison: ProjectUriComparison,
): boolean {
  return equalsProjectUri(left, right, comparison)
}

export type { ProjectUriComparison }
