import {
  canonicalJson,
  parseMarketplaceDescriptor,
  parseRegistryV2,
  parseShowcaseV2,
  sha256Hex,
  type MarketplaceDescriptor,
  type RegistryPackage,
  type RegistryV2,
  type ShowcaseAsset,
  type ShowcaseV2,
} from "@convax/marketplace"
import { releaseTagForPackage } from "./release"

export const MARKETPLACE_SELECTION_CONTEXT_SCHEMA = "convax.marketplace-selection-context/1" as const

export type MarketplaceSelectionContext = {
  schema: typeof MARKETPLACE_SELECTION_CONTEXT_SCHEMA
  descriptor: MarketplaceDescriptor
  selectedPackages: Array<{
    kind: RegistryPackage["kind"]
    id: string
    version: string
    sourcePreviousVersion?: string
    productionPreviousVersion?: string
    releaseTag: string
  }>
  baseline: { mode: "v2"; registry: RegistryV2; showcase: ShowcaseV2 }
}

const ITEM_KINDS = new Set(["plugin", "skill", "mcp-server"])
const ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/
const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,254}$/
const RELEASE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function packageIdentity(entry: { kind: string; id: string }): string {
  return `${entry.kind}\0${entry.id}`
}

export function parsePublishIdentities(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 16_384) {
    throw new TypeError("publish identities must be a bounded non-empty array")
  }
  const seen = new Set<string>()
  return value.map((identity) => {
    if (typeof identity !== "string") throw new TypeError("publish identity must be a string")
    const separator = identity.indexOf("\0")
    const kind = identity.slice(0, separator)
    const id = identity.slice(separator + 1)
    if (separator <= 0 || identity.indexOf("\0", separator + 1) !== -1 || !ITEM_KINDS.has(kind) || !ID.test(id)) {
      throw new TypeError("publish identity is invalid")
    }
    if (seen.has(identity)) throw new TypeError(`duplicate publish identity ${kind}/${id}`)
    seen.add(identity)
    return identity
  })
}

function packageMap(packages: readonly RegistryPackage[], label: string): Map<string, RegistryPackage> {
  const result = new Map<string, RegistryPackage>()
  for (const entry of packages) {
    const identity = packageIdentity(entry)
    if (result.has(identity)) throw new TypeError(`${label} contains duplicate ${entry.kind}/${entry.id}`)
    result.set(identity, entry)
  }
  return result
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareSemver(left: string, right: string): number {
  const leftMatch = SEMVER.exec(left)
  const rightMatch = SEMVER.exec(right)
  if (!leftMatch || !rightMatch) throw new TypeError("Plugin and Skill selections must use SemVer")
  for (let index = 1; index <= 3; index += 1) {
    const leftPart = BigInt(leftMatch[index]!)
    const rightPart = BigInt(rightMatch[index]!)
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  const leftPrerelease = leftMatch[4]?.split(".")
  const rightPrerelease = rightMatch[4]?.split(".")
  if (!leftPrerelease && !rightPrerelease) return 0
  if (!leftPrerelease) return 1
  if (!rightPrerelease) return -1
  for (let index = 0; index < Math.max(leftPrerelease.length, rightPrerelease.length); index += 1) {
    const leftPart = leftPrerelease[index]
    const rightPart = rightPrerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumeric = /^(0|[1-9][0-9]*)$/.test(leftPart)
    const rightNumeric = /^(0|[1-9][0-9]*)$/.test(rightPart)
    if (leftNumeric && rightNumeric) return BigInt(leftPart) < BigInt(rightPart) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return compareAscii(leftPart, rightPart)
  }
  return 0
}

function assertVersionAdvanced(
  selection: MarketplaceSelectionContext["selectedPackages"][number],
  previous: string | undefined,
  label: string,
): void {
  if (previous === undefined) return
  if (selection.kind === "mcp-server") {
    if (selection.version === previous) throw new TypeError(`${label} did not change its immutable version`)
    return
  }
  if (compareSemver(selection.version, previous) <= 0) {
    throw new TypeError(`${label} version must advance beyond ${previous}`)
  }
}

function exactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unsupported or missing fields`)
  }
}

export function parseMarketplaceSelectionContext(
  value: unknown,
  descriptor: MarketplaceDescriptor,
): MarketplaceSelectionContext {
  exactKeys(value, ["baseline", "descriptor", "schema", "selectedPackages"], "selection context")
  if (value.schema !== MARKETPLACE_SELECTION_CONTEXT_SCHEMA) {
    throw new TypeError("selection context schema is unsupported")
  }
  const baselineDescriptor = parseMarketplaceDescriptor(value.descriptor)
  if (canonicalJson(baselineDescriptor) !== canonicalJson(descriptor)) {
    throw new TypeError("selective package publication cannot change the Marketplace descriptor")
  }
  if (
    !Array.isArray(value.selectedPackages) ||
    value.selectedPackages.length === 0 ||
    value.selectedPackages.length > 16_384
  ) {
    throw new TypeError("selection context must contain bounded selected packages")
  }
  const selectedPackages = value.selectedPackages.map((selectionValue) => {
    if (!selectionValue || typeof selectionValue !== "object" || Array.isArray(selectionValue)) {
      throw new TypeError("selected package must be an object")
    }
    const selection = selectionValue as Record<string, unknown>
    exactKeys(
      selection,
      [
        "id",
        "kind",
        "releaseTag",
        "version",
        ...(selection.sourcePreviousVersion === undefined ? [] : ["sourcePreviousVersion"]),
        ...(selection.productionPreviousVersion === undefined ? [] : ["productionPreviousVersion"]),
      ],
      "selected package",
    )
    if (
      typeof selection.kind !== "string" ||
      !ITEM_KINDS.has(selection.kind) ||
      typeof selection.id !== "string" ||
      !ID.test(selection.id) ||
      typeof selection.version !== "string" ||
      !VERSION.test(selection.version) ||
      (selection.sourcePreviousVersion !== undefined &&
        (typeof selection.sourcePreviousVersion !== "string" || !VERSION.test(selection.sourcePreviousVersion))) ||
      (selection.productionPreviousVersion !== undefined &&
        (typeof selection.productionPreviousVersion !== "string" ||
          !VERSION.test(selection.productionPreviousVersion))) ||
      typeof selection.releaseTag !== "string" ||
      !RELEASE_TAG.test(selection.releaseTag)
    ) {
      throw new TypeError("selected package identity, versions, or Release tag is invalid")
    }
    return {
      kind: selection.kind as RegistryPackage["kind"],
      id: selection.id,
      version: selection.version,
      ...(selection.sourcePreviousVersion === undefined
        ? {}
        : { sourcePreviousVersion: selection.sourcePreviousVersion }),
      ...(selection.productionPreviousVersion === undefined
        ? {}
        : { productionPreviousVersion: selection.productionPreviousVersion }),
      releaseTag: selection.releaseTag,
    }
  })
  parsePublishIdentities(selectedPackages.map(packageIdentity))
  if (new Set(selectedPackages.map(({ releaseTag }) => releaseTag)).size !== selectedPackages.length) {
    throw new TypeError("selected packages must use unique immutable Release tags")
  }
  exactKeys(value.baseline, ["mode", "registry", "showcase"], "selection baseline")
  if (value.baseline.mode !== "v2") throw new TypeError("selection baseline mode must be v2")
  const registry = parseRegistryV2(value.baseline.registry)
  if (registry.marketplaceId !== descriptor.id) {
    throw new TypeError("selection baseline belongs to another Marketplace")
  }
  return {
    schema: MARKETPLACE_SELECTION_CONTEXT_SCHEMA,
    descriptor: baselineDescriptor,
    selectedPackages,
    baseline: {
      mode: "v2",
      registry,
      showcase: parseShowcaseV2(value.baseline.showcase, registry, descriptor),
    },
  }
}

export function selectionBaselineRegistry(
  context: MarketplaceSelectionContext,
  _descriptor: MarketplaceDescriptor,
): RegistryV2 {
  return context.baseline.registry
}

export function mergeSelectedRegistry(
  baselineValue: RegistryV2,
  candidateValue: RegistryV2,
  selectedIdentitiesValue: readonly string[],
): RegistryV2 {
  const baseline = parseRegistryV2(baselineValue)
  const candidate = parseRegistryV2(candidateValue)
  const selectedIdentities = parsePublishIdentities(selectedIdentitiesValue)!
  if (baseline.marketplaceId !== candidate.marketplaceId) {
    throw new TypeError("candidate Registry belongs to another Marketplace")
  }
  if (candidate.sequence <= baseline.sequence) {
    throw new TypeError("selective Registry sequence must advance production")
  }
  const baselineByIdentity = packageMap(baseline.packages, "baseline Registry")
  const candidateByIdentity = packageMap(candidate.packages, "candidate Registry")
  const selected = new Set(selectedIdentities)
  for (const identity of selected) {
    const candidateEntry = candidateByIdentity.get(identity)
    if (!candidateEntry) {
      throw new TypeError(`selected package ${identity.replace("\0", "/")} is absent from source`)
    }
    if (baselineByIdentity.get(identity)?.version === candidateEntry.version) {
      throw new TypeError(`selected package ${identity.replace("\0", "/")} did not advance its immutable version`)
    }
  }
  const packages = baseline.packages.map((entry) =>
    selected.has(packageIdentity(entry)) ? candidateByIdentity.get(packageIdentity(entry))! : entry,
  )
  for (const entry of candidate.packages) {
    const identity = packageIdentity(entry)
    if (selected.has(identity) && !baselineByIdentity.has(identity)) packages.push(entry)
  }
  packages.sort((left, right) => compareAscii(packageIdentity(left), packageIdentity(right)))
  return parseRegistryV2({
    schema: "convax.registry/2",
    marketplaceId: baseline.marketplaceId,
    sequence: candidate.sequence,
    revision: sha256Hex(canonicalJson(packages)),
    packages,
  })
}

function releaseAssetName(url: string): string {
  const parsed = new URL(url)
  return parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1)
}

function currentShowcaseUrl(descriptor: MarketplaceDescriptor, revision: string, sourceUrl: string): string {
  return `https://github.com/${descriptor.repository.owner}/${descriptor.repository.name}/releases/download/registry-v2-${revision}/${releaseAssetName(sourceUrl)}`
}

export function inheritedShowcasePackages(
  context: MarketplaceSelectionContext,
  descriptor: MarketplaceDescriptor,
  registry: RegistryV2,
): Array<{
  package: ShowcaseV2["packages"][number]
  sources: Array<{ source: ShowcaseAsset; targetUrl: string }>
}> {
  const selected = new Set(context.selectedPackages.map(packageIdentity))
  return context.baseline.showcase.packages.flatMap((entry) => {
    if (selected.has(packageIdentity(entry))) return []
    const sources = [
      entry.presentation.poster,
      ...(entry.presentation.animation ? [entry.presentation.animation] : []),
    ].map((source) => ({ source, targetUrl: currentShowcaseUrl(descriptor, registry.revision, source.url) }))
    return [
      {
        package: {
          kind: entry.kind,
          id: entry.id,
          version: entry.version,
          presentation: {
            ...entry.presentation,
            poster: { ...entry.presentation.poster, url: sources[0]!.targetUrl },
            ...(entry.presentation.animation
              ? { animation: { ...entry.presentation.animation, url: sources[1]!.targetUrl } }
              : {}),
          },
        },
        sources,
      },
    ]
  })
}

export function assertSelectiveMarketplaceClosure(options: {
  context: MarketplaceSelectionContext
  descriptor: MarketplaceDescriptor
  registry: RegistryV2
  showcase: ShowcaseV2
}): { inheritedIdentities: Set<string> } {
  const context = parseMarketplaceSelectionContext(options.context, options.descriptor)
  const registry = parseRegistryV2(options.registry)
  const showcase = parseShowcaseV2(options.showcase, registry, options.descriptor)
  const baseline = context.baseline.registry
  if (registry.marketplaceId !== baseline.marketplaceId || registry.sequence <= baseline.sequence) {
    throw new TypeError("selective Registry must preserve its Marketplace and advance production sequence")
  }
  const selected = new Set(context.selectedPackages.map(packageIdentity))
  const baselineByIdentity = packageMap(baseline.packages, "baseline Registry")
  const currentByIdentity = packageMap(registry.packages, "selective Registry")
  for (const selection of context.selectedPackages) {
    const identity = packageIdentity(selection)
    const current = currentByIdentity.get(identity)
    if (!current || current.version !== selection.version) {
      throw new TypeError(`selected package ${identity.replace("\0", "/")} does not match its planned version`)
    }
    const previous = baselineByIdentity.get(identity)
    if (
      previous?.version !== selection.productionPreviousVersion ||
      (!previous && selection.productionPreviousVersion !== undefined)
    ) {
      throw new TypeError(`selected package ${identity.replace("\0", "/")} does not match production baseline`)
    }
    if (selection.releaseTag !== releaseTagForPackage(selection)) {
      throw new TypeError(`selected package ${identity.replace("\0", "/")} has the wrong immutable Release tag`)
    }
    assertVersionAdvanced(selection, selection.sourcePreviousVersion, `selected package ${identity.replace("\0", "/")}`)
    assertVersionAdvanced(
      selection,
      selection.productionPreviousVersion,
      `selected package ${identity.replace("\0", "/")}`,
    )
  }
  for (const [identity, entry] of baselineByIdentity) {
    const current = currentByIdentity.get(identity)
    if (!selected.has(identity) && (!current || canonicalJson(current) !== canonicalJson(entry))) {
      throw new TypeError(`unselected package ${identity.replace("\0", "/")} changed or disappeared`)
    }
  }
  for (const identity of currentByIdentity.keys()) {
    if (!selected.has(identity) && !baselineByIdentity.has(identity)) {
      throw new TypeError(`unselected source-only package ${identity.replace("\0", "/")} entered the Registry`)
    }
  }
  const expectedShowcase = new Map(
    inheritedShowcasePackages(context, options.descriptor, registry).map(({ package: entry }) => [
      packageIdentity(entry),
      entry,
    ]),
  )
  const currentShowcase = new Map(showcase.packages.map((entry) => [packageIdentity(entry), entry]))
  for (const [identity, entry] of expectedShowcase) {
    if (canonicalJson(currentShowcase.get(identity)) !== canonicalJson(entry)) {
      throw new TypeError(`unselected Showcase ${identity.replace("\0", "/")} changed or disappeared`)
    }
  }
  for (const identity of currentShowcase.keys()) {
    if (!selected.has(identity) && !expectedShowcase.has(identity)) {
      throw new TypeError(`unselected Showcase ${identity.replace("\0", "/")} entered publication`)
    }
  }
  return {
    inheritedIdentities: new Set([...baselineByIdentity.keys()].filter((identity) => !selected.has(identity))),
  }
}
