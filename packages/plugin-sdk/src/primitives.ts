const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i

export function portableRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}

export function assertPortableKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const expected = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !expected.has(key))
  if (unknown) throw new TypeError(`${label} contains an unsupported field: ${unknown}`)
}

export function portableText(value: unknown, label: string, maximum: number) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded, trimmed string`)
  }
  return value
}

export function portableArray(
  value: unknown,
  label: string,
  maximum: number,
  nonEmpty = false,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || (nonEmpty && value.length === 0)) {
    throw new TypeError(
      `${label} must be ${nonEmpty ? "a non-empty " : "a "}bounded array with at most ${maximum} items`,
    )
  }
  return value
}

export function deepFreezePortable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreezePortable(item)
    Object.freeze(value)
  }
  return value
}

function compareNumericIdentifier(left: string, right: string) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left === right ? 0 : left < right ? -1 : 1
}

function splitSemver(value: string) {
  if (!semverPattern.test(value)) throw new TypeError("Plugin version must be valid SemVer")
  const withoutBuild = value.split("+", 1)[0]
  const prereleaseIndex = withoutBuild.indexOf("-")
  const core = (prereleaseIndex === -1 ? withoutBuild : withoutBuild.slice(0, prereleaseIndex)).split(".")
  const prerelease = prereleaseIndex === -1 ? [] : withoutBuild.slice(prereleaseIndex + 1).split(".")
  return { core, prerelease }
}

export function parsePortablePluginVersion(value: unknown) {
  const version = portableText(value, "Plugin version", 128)
  if (!semverPattern.test(version)) throw new TypeError("Plugin version must be valid SemVer")
  return version
}

/** Compares two validated Plugin SemVer values using SemVer precedence. */
export function comparePortablePluginVersions(left: string, right: string) {
  const leftVersion = splitSemver(left)
  const rightVersion = splitSemver(right)
  for (let index = 0; index < 3; index += 1) {
    const compared = compareNumericIdentifier(leftVersion.core[index]!, rightVersion.core[index]!)
    if (compared) return compared
  }
  if (leftVersion.prerelease.length === 0 || rightVersion.prerelease.length === 0) {
    return leftVersion.prerelease.length === rightVersion.prerelease.length
      ? 0
      : leftVersion.prerelease.length === 0
        ? 1
        : -1
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === rightIdentifier ? 0 : leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) continue
    const leftNumeric = /^\d+$/u.test(leftIdentifier)
    const rightNumeric = /^\d+$/u.test(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumericIdentifier(leftIdentifier, rightIdentifier)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

export function validatePortablePluginSegment(value: string) {
  const stem = value.split(".")[0] ?? ""
  if (
    !value ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(value) ||
    /[. ]$/u.test(value) ||
    windowsReservedName.test(stem)
  ) {
    throw new TypeError(`Plugin path contains an invalid Windows filename: ${value}`)
  }
  return value
}

export function parsePortablePluginId(value: unknown) {
  const id = portableText(value, "Plugin id", 80)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new TypeError("Plugin id must use kebab-case")
  }
  validatePortablePluginSegment(id)
  return id
}

/** Validate a portable POSIX path without repairing or normalizing caller input. */
export function parsePortablePluginRelativePath(value: unknown, label = "Plugin path") {
  const input = portableText(value, label, 1_024)
  if (input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/u.test(input) || input.startsWith("//")) {
    throw new TypeError(`${label} must be a portable relative path`)
  }
  const segments = input.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new TypeError(`${label} must be a portable relative path`)
  }
  segments.forEach(validatePortablePluginSegment)
  return input
}

export function parsePortableStringArray(
  value: unknown,
  label: string,
  validate: (item: string) => string,
): readonly string[] | undefined {
  if (value === undefined) return undefined
  const items = portableArray(value, label, 64).map((item) =>
    validate(portableText(item, label, 128)),
  )
  if (new Set(items).size !== items.length) throw new TypeError(`${label} contains duplicate values`)
  return items
}

export function parsePortableStableId(value: unknown, label: string, maximum = 80) {
  const id = portableText(value, label, maximum)
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(id)) {
    throw new TypeError(`${label} is invalid: ${id}`)
  }
  return id
}
