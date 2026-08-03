export interface UriComponents {
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string
}

export type ConvaxScheme =
  | "convax"
  | "convax-asset"
  | "convax-connected-media"
  | "convax-pet-asset"
  | "convax-plugin"
  | "convax-project"

export type AuthorityGrammar = "ascii-case-insensitive" | "opaque-case-sensitive"

export interface ConvaxSchemeRule {
  readonly scheme: ConvaxScheme
  readonly owner: string
  readonly authorityGrammar: AuthorityGrammar
  readonly authorityRequired: true
  readonly fragment: "allowed" | "forbidden"
}

const schemeRules = [
  {
    scheme: "convax-project",
    owner: "@convax/project-files contract; @convax/project/node adapter",
    authorityGrammar: "opaque-case-sensitive",
    authorityRequired: true,
    fragment: "forbidden",
  },
  {
    scheme: "convax-asset",
    owner: "@convax/project/node and Desktop protocol adapter",
    authorityGrammar: "ascii-case-insensitive",
    authorityRequired: true,
    fragment: "allowed",
  },
  {
    scheme: "convax",
    owner: "Desktop Agent resource adapter",
    authorityGrammar: "ascii-case-insensitive",
    authorityRequired: true,
    fragment: "allowed",
  },
  {
    scheme: "convax-plugin",
    owner: "Desktop Plugin asset adapter",
    authorityGrammar: "ascii-case-insensitive",
    authorityRequired: true,
    fragment: "allowed",
  },
  {
    scheme: "convax-connected-media",
    owner: "Desktop connected-media session owner",
    authorityGrammar: "ascii-case-insensitive",
    authorityRequired: true,
    fragment: "allowed",
  },
  {
    scheme: "convax-pet-asset",
    owner: "Desktop Pet platform adapter",
    authorityGrammar: "ascii-case-insensitive",
    authorityRequired: true,
    fragment: "allowed",
  },
] as const satisfies readonly ConvaxSchemeRule[]

for (const rule of schemeRules) Object.freeze(rule)

/** Static allocation data only. It is not a handler or resolver registry. */
export const CONVAX_SCHEME_RULES: readonly ConvaxSchemeRule[] = Object.freeze(schemeRules)

export const URI_LIMITS = Object.freeze({
  totalBytes: 16 * 1024,
  componentBytes: 8 * 1024,
  queryItems: 64,
})

export type UriParseErrorCode =
  | "URI_TOO_LONG"
  | "COMPONENT_TOO_LONG"
  | "INVALID_SCHEME"
  | "UNSUPPORTED_SCHEME"
  | "AUTHORITY_REQUIRED"
  | "INVALID_AUTHORITY"
  | "INVALID_PATH"
  | "PATH_TRAVERSAL"
  | "INVALID_QUERY"
  | "TOO_MANY_QUERY_ITEMS"
  | "DUPLICATE_QUERY_KEY"
  | "FRAGMENT_FORBIDDEN"
  | "MALFORMED_PERCENT_ENCODING"
  | "INVALID_UTF8"
  | "INVALID_CHARACTER"
  | "NON_NFC"
  | "NON_CANONICAL"
  | "INVALID_PROJECT_URI"
  | "INVALID_PROJECT_ID"
  | "INVALID_PROJECT_EPOCH"
  | "INVALID_PROJECT_ENTRY_ID"
  | "INVALID_BLOB_DIGEST"

export class UriParseError extends Error {
  readonly code: UriParseErrorCode

  constructor(code: UriParseErrorCode, message: string) {
    super(message)
    this.name = "UriParseError"
    this.code = code
  }
}

export interface QueryEntry {
  /** NFC-normalized decoded key. */
  readonly key: string
  /** NFC-normalized decoded value. */
  readonly value: string
}

export type ProjectUriComparison = "entry" | "entry-revision" | "canonical-string"

export interface ProjectUriComponents {
  readonly projectId: string
  readonly projectEpoch: string
  /** Lexically validated only; the canonical opaque type belongs to @convax/project-files. */
  readonly entryId: string
  readonly path?: string
  readonly blob?: `sha256:${string}`
}

interface CanonicalComponent {
  readonly encoded: string
  readonly decoded: string
  readonly changedNfc: boolean
}

interface ParsedInternal {
  readonly components: UriComponents & { readonly scheme: ConvaxScheme }
  readonly canonical: string
  readonly queryEntries: readonly QueryEntry[]
  readonly pathSegments: readonly string[]
  readonly changedNfc: boolean
}

const encoder = new TextEncoder()
const schemePattern = /^[A-Za-z][A-Za-z0-9+.-]*$/u
const unreservedPattern = /^[A-Za-z0-9._~-]$/u
const authorityLiteralPattern = /^[A-Za-z0-9._~!$&'()*+,;=-]$/u
const pathLiteralPattern = /^[A-Za-z0-9._~!$&'()*+,;=:@-]$/u
const queryLiteralPattern = /^[A-Za-z0-9._~!$'()*+,;=:@/?-]$/u
const fragmentLiteralPattern = queryLiteralPattern
const canonicalAuthorityPattern = /^[a-z0-9][a-z0-9._~-]{0,255}$/u
const projectIdPattern = /^[a-z0-9][a-z0-9_-]{0,95}$/u
const projectEpochPattern = /^[A-Za-z0-9_-]{21}[AQgw]$/u
const projectEntryIdPattern = /^p[fd]_[0-9a-f]{64}$/u
const blobRevisionPattern = /^sha256:[0-9a-f]{64}$/u

function isBlobRevision(value: string): value is `sha256:${string}` {
  return blobRevisionPattern.test(value)
}

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength
}

function assertByteLimit(value: string, limit: number, code: UriParseErrorCode, label: string): void {
  if (utf8Length(value) > limit) throw new UriParseError(code, `${label} exceeds ${limit} UTF-8 bytes`)
}

function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

function hasControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || codePoint === 0x7f) return true
  }
  return false
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) {
        throw new UriParseError("INVALID_UTF8", "URI component contains an unpaired UTF-16 surrogate")
      }
      index += 1
      continue
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new UriParseError("INVALID_UTF8", "URI component contains an unpaired UTF-16 surrogate")
    }
  }
}

function encodeCanonical(decoded: string): string {
  assertWellFormedUnicode(decoded)
  let result = ""
  for (const character of decoded) {
    if (unreservedPattern.test(character)) {
      result += character
      continue
    }
    for (const byte of encoder.encode(character)) result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
  }
  return result
}

function validateRawComponent(raw: string, literalPattern: RegExp, label: string): void {
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? ""
    const code = raw.charCodeAt(index)
    if (code > 0x7f || code <= 0x1f || code === 0x7f) {
      throw new UriParseError("INVALID_CHARACTER", `${label} contains an unencoded or control character`)
    }
    if (character === "%") {
      if (!/^[0-9A-Fa-f]{2}$/u.test(raw.slice(index + 1, index + 3))) {
        throw new UriParseError("MALFORMED_PERCENT_ENCODING", `${label} contains malformed percent-encoding`)
      }
      index += 2
      continue
    }
    if (!literalPattern.test(character)) {
      throw new UriParseError("INVALID_CHARACTER", `${label} contains a character outside its URI grammar`)
    }
  }
}

function canonicalComponent(raw: string, literalPattern: RegExp, label: string): CanonicalComponent {
  validateRawComponent(raw, literalPattern, label)
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    throw new UriParseError("INVALID_UTF8", `${label} contains invalid percent-encoded UTF-8`)
  }
  if (decoded.includes("\\") || hasControl(decoded)) {
    throw new UriParseError("INVALID_CHARACTER", `${label} contains a backslash, NUL, or control character`)
  }
  const normalized = decoded.normalize("NFC")
  return { encoded: encodeCanonical(normalized), decoded: normalized, changedNfc: normalized !== decoded }
}

function canonicalAuthority(raw: string, rule: ConvaxSchemeRule): CanonicalComponent {
  if (rule.authorityGrammar === "opaque-case-sensitive") {
    if (!projectIdPattern.test(raw)) {
      throw new UriParseError(
        "INVALID_PROJECT_ID",
        "convax-project authority must be the canonical lowercase ProjectId and cannot use percent aliases",
      )
    }
    return { encoded: raw, decoded: raw, changedNfc: false }
  }

  const component = canonicalComponent(raw, authorityLiteralPattern, "authority")
  if (!/^[\x00-\x7F]*$/u.test(component.decoded)) {
    throw new UriParseError("INVALID_AUTHORITY", "authority must be an ASCII identifier")
  }
  const lowered = component.decoded.toLowerCase()
  if (!canonicalAuthorityPattern.test(lowered)) {
    throw new UriParseError("INVALID_AUTHORITY", "authority is not a canonical ASCII identifier")
  }
  return { encoded: lowered, decoded: lowered, changedNfc: component.changedNfc }
}

function parseQuery(raw: string): {
  readonly encoded: string
  readonly entries: readonly QueryEntry[]
  readonly changedNfc: boolean
} {
  if (raw === "") return { encoded: "", entries: [], changedNfc: false }
  const parts = raw.split("&")
  if (parts.length > URI_LIMITS.queryItems) {
    throw new UriParseError("TOO_MANY_QUERY_ITEMS", `query exceeds ${URI_LIMITS.queryItems} items`)
  }

  let changedNfc = false
  const canonicalEntries = parts.map((part, index) => {
    if (part === "") throw new UriParseError("INVALID_QUERY", `query item ${index} is empty`)
    const separator = part.indexOf("=")
    const rawKey = separator < 0 ? part : part.slice(0, separator)
    const rawValue = separator < 0 ? "" : part.slice(separator + 1)
    if (rawKey === "") throw new UriParseError("INVALID_QUERY", `query item ${index} has an empty key`)
    const key = canonicalComponent(rawKey, queryLiteralPattern, `query key ${index}`)
    const value = canonicalComponent(rawValue, queryLiteralPattern, `query value ${index}`)
    changedNfc ||= key.changedNfc || value.changedNfc
    return { key: key.decoded, value: value.decoded, encodedKey: key.encoded, encodedValue: value.encoded }
  })

  canonicalEntries.sort((left, right) => compareUtf8(left.key, right.key) || compareUtf8(left.value, right.value))
  return {
    encoded: canonicalEntries.map((entry) => `${entry.encodedKey}=${entry.encodedValue}`).join("&"),
    entries: canonicalEntries.map(({ key, value }) => Object.freeze({ key, value })),
    changedNfc,
  }
}

function validateProjectRelativePath(path: string): void {
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/")) {
    throw new UriParseError("INVALID_PROJECT_URI", "Project URI path hint must be a non-empty relative path")
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new UriParseError("PATH_TRAVERSAL", "Project URI path hint must be normalized and traversal-free")
    }
  }
  if (path.includes("\\") || hasControl(path)) {
    throw new UriParseError("INVALID_PROJECT_URI", "Project URI path hint contains a forbidden character")
  }
}

function projectValues(parsed: ParsedInternal): ProjectUriComponents {
  if (parsed.components.scheme !== "convax-project") {
    throw new UriParseError("INVALID_PROJECT_URI", "URI scheme must be convax-project")
  }
  const segments = parsed.pathSegments
  if (segments.length !== 4 || segments[0] !== "epochs" || segments[2] !== "entries") {
    throw new UriParseError("INVALID_PROJECT_URI", "convax-project path must be /epochs/<epoch>/entries/<entry-id>")
  }
  const projectEpoch = segments[1] ?? ""
  const entryId = segments[3] ?? ""
  if (!projectEpochPattern.test(projectEpoch)) {
    throw new UriParseError("INVALID_PROJECT_EPOCH", "Project epoch must be canonical unpadded base64url for 16 bytes")
  }
  if (!projectEntryIdPattern.test(entryId)) {
    throw new UriParseError("INVALID_PROJECT_ENTRY_ID", "Project entry id must be pf_/pd_ followed by 64 lowercase hex")
  }

  let path: string | undefined
  let blob: `sha256:${string}` | undefined
  const seen = new Set<string>()
  for (const entry of parsed.queryEntries) {
    if (seen.has(entry.key)) {
      throw new UriParseError("DUPLICATE_QUERY_KEY", `convax-project query key ${entry.key} is duplicated`)
    }
    seen.add(entry.key)
    if (entry.key === "path") {
      validateProjectRelativePath(entry.value)
      path = entry.value
      continue
    }
    if (entry.key === "blob") {
      if (!isBlobRevision(entry.value)) {
        throw new UriParseError("INVALID_BLOB_DIGEST", "blob must be sha256: followed by 64 lowercase hex")
      }
      blob = entry.value
      continue
    }
    throw new UriParseError("INVALID_QUERY", `convax-project query key ${entry.key} is not allocated`)
  }
  return Object.freeze({ projectId: parsed.components.authority, projectEpoch, entryId, path, blob })
}

function parseInternal(input: string): ParsedInternal {
  if (typeof input !== "string") {
    throw new UriParseError("INVALID_CHARACTER", "URI input must be a string")
  }
  assertByteLimit(input, URI_LIMITS.totalBytes, "URI_TOO_LONG", "URI")
  const colon = input.indexOf(":")
  if (colon <= 0) throw new UriParseError("INVALID_SCHEME", "URI must start with a scheme")
  const rawScheme = input.slice(0, colon)
  assertByteLimit(rawScheme, URI_LIMITS.componentBytes, "COMPONENT_TOO_LONG", "scheme")
  if (!schemePattern.test(rawScheme)) throw new UriParseError("INVALID_SCHEME", "URI scheme is malformed")
  const normalizedScheme = rawScheme.toLowerCase()
  const rule = CONVAX_SCHEME_RULES.find((candidate) => candidate.scheme === normalizedScheme)
  if (!rule) throw new UriParseError("UNSUPPORTED_SCHEME", `Convax scheme ${rawScheme} is not allocated`)
  const scheme = rule.scheme

  let remainder = input.slice(colon + 1)
  let rawFragment = ""
  const fragmentIndex = remainder.indexOf("#")
  if (fragmentIndex >= 0) {
    rawFragment = remainder.slice(fragmentIndex + 1)
    remainder = remainder.slice(0, fragmentIndex)
  }
  let rawQuery = ""
  const queryIndex = remainder.indexOf("?")
  if (queryIndex >= 0) {
    rawQuery = remainder.slice(queryIndex + 1)
    remainder = remainder.slice(0, queryIndex)
  }
  if (!remainder.startsWith("//")) {
    throw new UriParseError("AUTHORITY_REQUIRED", `${scheme} requires //authority syntax`)
  }
  const authorityAndPath = remainder.slice(2)
  const slash = authorityAndPath.indexOf("/")
  const rawAuthority = slash < 0 ? authorityAndPath : authorityAndPath.slice(0, slash)
  const rawPath = slash < 0 ? "" : authorityAndPath.slice(slash)
  assertByteLimit(rawAuthority, URI_LIMITS.componentBytes, "COMPONENT_TOO_LONG", "authority")
  assertByteLimit(rawPath, URI_LIMITS.componentBytes, "COMPONENT_TOO_LONG", "path")
  assertByteLimit(rawQuery, URI_LIMITS.componentBytes, "COMPONENT_TOO_LONG", "query")
  assertByteLimit(rawFragment, URI_LIMITS.componentBytes, "COMPONENT_TOO_LONG", "fragment")
  if (rawAuthority === "") throw new UriParseError("AUTHORITY_REQUIRED", `${scheme} requires a non-empty authority`)

  const authority = canonicalAuthority(rawAuthority, rule)
  const pathSegments: string[] = []
  let encodedPath = ""
  let pathChangedNfc = false
  if (rawPath !== "") {
    if (!rawPath.startsWith("/")) throw new UriParseError("INVALID_PATH", "URI path must be empty or absolute")
    const rawSegments = rawPath.slice(1).split("/")
    const encodedSegments = rawSegments.map((rawSegment, index) => {
      const component = canonicalComponent(rawSegment, pathLiteralPattern, `path segment ${index}`)
      if (component.decoded === "." || component.decoded === "..") {
        throw new UriParseError("PATH_TRAVERSAL", "URI path cannot contain . or .. segments")
      }
      pathChangedNfc ||= component.changedNfc
      pathSegments.push(component.decoded)
      return component.encoded
    })
    encodedPath = `/${encodedSegments.join("/")}`
  }

  const query = parseQuery(rawQuery)
  const fragment = canonicalComponent(rawFragment, fragmentLiteralPattern, "fragment")
  if (rule.fragment === "forbidden" && fragment.encoded !== "") {
    throw new UriParseError("FRAGMENT_FORBIDDEN", `${scheme} does not allow fragments`)
  }

  const components = Object.freeze({
    scheme,
    authority: authority.encoded,
    path: encodedPath,
    query: query.encoded,
    fragment: fragment.encoded,
  })
  for (const [label, value] of Object.entries(components)) {
    assertByteLimit(value, URI_LIMITS.componentBytes, "COMPONENT_TOO_LONG", label)
  }
  const canonical = `${scheme}://${authority.encoded}${encodedPath}${query.encoded ? `?${query.encoded}` : ""}${
    fragment.encoded ? `#${fragment.encoded}` : ""
  }`
  assertByteLimit(canonical, URI_LIMITS.totalBytes, "URI_TOO_LONG", "canonical URI")
  const parsed = {
    components,
    canonical,
    queryEntries: Object.freeze([...query.entries]),
    pathSegments: Object.freeze(pathSegments),
    changedNfc: authority.changedNfc || pathChangedNfc || query.changedNfc || fragment.changedNfc,
  } satisfies ParsedInternal
  if (scheme === "convax-project") projectValues(parsed)
  return parsed
}

export class ConvaxUri implements UriComponents {
  readonly scheme: ConvaxScheme
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string
  readonly #canonical: string
  readonly #pathSegments: readonly string[]
  readonly #queryEntries: readonly QueryEntry[]

  private constructor(parsed: ParsedInternal) {
    this.scheme = parsed.components.scheme
    this.authority = parsed.components.authority
    this.path = parsed.components.path
    this.query = parsed.components.query
    this.fragment = parsed.components.fragment
    this.#canonical = parsed.canonical
    this.#pathSegments = parsed.pathSegments
    this.#queryEntries = parsed.queryEntries
    Object.freeze(this)
  }

  static parse(input: string): ConvaxUri {
    const parsed = parseInternal(input)
    if (parsed.changedNfc) throw new UriParseError("NON_NFC", "URI contains a component that is not NFC-normalized")
    if (input !== parsed.canonical) {
      throw new UriParseError("NON_CANONICAL", `URI is not canonical; expected ${parsed.canonical}`)
    }
    return new ConvaxUri(parsed)
  }

  static from(components: UriComponents): ConvaxUri {
    return from(components)
  }

  get queryEntries(): readonly QueryEntry[] {
    return this.#queryEntries
  }

  /**
   * Decoded NFC path segments with encoded separators preserved as data.
   *
   * Owners must use this projection when a segment carries an opaque id:
   * splitting `path` would confuse `%2F` inside an id with a structural slash.
   */
  get pathSegments(): readonly string[] {
    return this.#pathSegments
  }

  with(changes: Partial<UriComponents>): ConvaxUri {
    return from({
      scheme: changes.scheme ?? this.scheme,
      authority: changes.authority ?? this.authority,
      path: changes.path ?? this.path,
      query: changes.query ?? this.query,
      fragment: changes.fragment ?? this.fragment,
    })
  }

  equals(other: ConvaxUri | string): boolean {
    return equals(this, other)
  }

  toString(): string {
    return this.#canonical
  }

  toJSON(): UriComponents {
    return Object.freeze({
      scheme: this.scheme,
      authority: this.authority,
      path: this.path,
      query: this.query,
      fragment: this.fragment,
    })
  }
}

/** Strict protocol-boundary parse. Non-canonical bytes, including non-NFC input, are rejected. */
export function parse(input: string): ConvaxUri {
  return ConvaxUri.parse(input)
}

/** Explicitly normalizes a syntactically valid allocated Convax URI. */
export function canonicalize(input: string): string {
  return parseInternal(input).canonical
}

/** Build from URI-syntax components, then return the canonical immutable value. */
export function from(components: UriComponents): ConvaxUri {
  if (typeof components !== "object" || components === null) {
    throw new UriParseError("INVALID_CHARACTER", "URI components must be an object")
  }
  for (const key of ["scheme", "authority", "path", "query", "fragment"] as const) {
    if (typeof components[key] !== "string") {
      throw new UriParseError("INVALID_CHARACTER", `URI ${key} component must be a string`)
    }
  }
  if (!schemePattern.test(components.scheme)) {
    throw new UriParseError("INVALID_SCHEME", "URI scheme component is malformed")
  }
  if (/[/?#]/u.test(components.authority)) {
    throw new UriParseError("INVALID_AUTHORITY", "URI authority cannot contain component delimiters")
  }
  if (components.path !== "" && !components.path.startsWith("/")) {
    throw new UriParseError("INVALID_PATH", "URI path component must be empty or absolute")
  }
  if (/[?#]/u.test(components.path)) {
    throw new UriParseError("INVALID_PATH", "URI path cannot contain unencoded query or fragment delimiters")
  }
  if (components.query.includes("#")) {
    throw new UriParseError("INVALID_QUERY", "URI query cannot contain an unencoded fragment delimiter")
  }
  const serialized = `${components.scheme}:${components.authority ? `//${components.authority}` : ""}${components.path}${
    components.query ? `?${components.query}` : ""
  }${components.fragment ? `#${components.fragment}` : ""}`
  return parse(canonicalize(serialized))
}

export function equals(left: ConvaxUri | string, right: ConvaxUri | string): boolean {
  const leftCanonical = typeof left === "string" ? canonicalize(left) : left.toString()
  const rightCanonical = typeof right === "string" ? canonicalize(right) : right.toString()
  return leftCanonical === rightCanonical
}

/** Pure lexical validator only; it does not allocate or brand Project entry identity. */
export function isProjectEntryIdLexicallyValid(value: string): boolean {
  return projectEntryIdPattern.test(value)
}

export function classifyProjectEntryId(value: string): "file" | "directory" | null {
  if (!isProjectEntryIdLexicallyValid(value)) return null
  return value.startsWith("pf_") ? "file" : "directory"
}

export function parseProjectUri(input: ConvaxUri | string): ProjectUriComponents {
  const uri = typeof input === "string" ? parse(input) : input
  return projectValues(parseInternal(uri.toString()))
}

export function fromProjectUri(components: ProjectUriComponents): ConvaxUri {
  if (typeof components !== "object" || components === null) {
    throw new UriParseError("INVALID_PROJECT_URI", "Project URI components must be an object")
  }
  if (!projectIdPattern.test(components.projectId)) {
    throw new UriParseError("INVALID_PROJECT_ID", "projectId is not canonical")
  }
  if (!projectEpochPattern.test(components.projectEpoch)) {
    throw new UriParseError("INVALID_PROJECT_EPOCH", "projectEpoch is not canonical unpadded base64url")
  }
  if (!projectEntryIdPattern.test(components.entryId)) {
    throw new UriParseError("INVALID_PROJECT_ENTRY_ID", "entryId is not a canonical pf_/pd_ lexical value")
  }
  const query: string[] = []
  if (components.blob !== undefined) {
    if (!isBlobRevision(components.blob)) {
      throw new UriParseError("INVALID_BLOB_DIGEST", "blob must be sha256: followed by 64 lowercase hex")
    }
    query.push(`blob=${encodeCanonical(components.blob)}`)
  }
  if (components.path !== undefined) {
    if (typeof components.path !== "string") {
      throw new UriParseError("INVALID_PROJECT_URI", "Project URI path hint must be a string")
    }
    const normalizedPath = components.path.normalize("NFC")
    if (normalizedPath !== components.path) {
      throw new UriParseError("NON_NFC", "Project URI path hint must be NFC-normalized")
    }
    validateProjectRelativePath(components.path)
    query.push(`path=${encodeCanonical(components.path)}`)
  }
  return from({
    scheme: "convax-project",
    authority: components.projectId,
    path: `/epochs/${components.projectEpoch}/entries/${components.entryId}`,
    query: query.join("&"),
    fragment: "",
  })
}

export function equalsProjectUri(
  left: ConvaxUri | string,
  right: ConvaxUri | string,
  comparison: ProjectUriComparison,
): boolean {
  const leftUri = typeof left === "string" ? parse(left) : left
  const rightUri = typeof right === "string" ? parse(right) : right
  if (comparison === "canonical-string") return leftUri.toString() === rightUri.toString()
  const a = parseProjectUri(leftUri)
  const b = parseProjectUri(rightUri)
  if (a.projectId !== b.projectId || a.projectEpoch !== b.projectEpoch || a.entryId !== b.entryId) return false
  return comparison === "entry" || a.blob === b.blob
}
