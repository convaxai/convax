import { describe, expect, test } from "bun:test"

import {
  CONVAX_SCHEME_RULES,
  ConvaxUri,
  UriParseError,
  canonicalize,
  classifyProjectEntryId,
  equals,
  equalsProjectUri,
  from,
  fromProjectUri,
  isProjectEntryIdLexicallyValid,
  parse,
  parseProjectUri,
} from "../src"

const projectId = "project_0123456789abcdef0123456789abcdef"
const epoch = "AQEBAQEBAQEBAQEBAQEBAQ"
const fileId = `pf_${"1".repeat(64)}`
const directoryId = `pd_${"2".repeat(64)}`
const blob = `sha256:${"a".repeat(64)}` as const

function expectCode(action: () => unknown, code: UriParseError["code"]): void {
  try {
    action()
    throw new Error(`expected ${code}`)
  } catch (error) {
    if (!(error instanceof UriParseError)) throw error
    expect(error.code).toBe(code)
  }
}

describe("canonical Convax URI codec", () => {
  test("canonicalizes scheme, authority, percent bytes, NFC, and query byte order", () => {
    expect(canonicalize("CONVAX://CANVAS/caf%C3%A9?z=%7e&a=%65%CC%81")).toBe("convax://canvas/caf%C3%A9?a=%C3%A9&z=~")
    expectCode(() => parse("CONVAX://CANVAS/caf%C3%A9?z=%7e&a=%65%CC%81"), "NON_NFC")
    expect(parse("convax://canvas/caf%C3%A9?a=%C3%A9&z=~").toString()).toBe("convax://canvas/caf%C3%A9?a=%C3%A9&z=~")
  })

  test("rejects malformed percent encodings, invalid UTF-8, controls, traversal, and backslashes", () => {
    expectCode(() => canonicalize("convax://canvas/%"), "MALFORMED_PERCENT_ENCODING")
    expectCode(() => canonicalize("convax://canvas/%E0%A4%A"), "MALFORMED_PERCENT_ENCODING")
    expectCode(() => canonicalize("convax://canvas/%FF"), "INVALID_UTF8")
    expectCode(() => canonicalize("convax://canvas/%ED%A0%80"), "INVALID_UTF8")
    expectCode(() => canonicalize("convax://canvas/%C0%AF"), "INVALID_UTF8")
    expectCode(() => canonicalize("convax://canvas/%00"), "INVALID_CHARACTER")
    expectCode(() => canonicalize("convax://canvas/%2E%2E"), "PATH_TRAVERSAL")
    expectCode(() => canonicalize("convax://canvas/folder%5Cfile"), "INVALID_CHARACTER")
  })

  test("rejects unallocated schemes and malformed authorities without exposing a registry", () => {
    expect(CONVAX_SCHEME_RULES.map((rule) => rule.scheme)).not.toContain("convax-plugin-asset")
    expectCode(() => canonicalize("convax-plugin-asset://plugin/index.html"), "UNSUPPORTED_SCHEME")
    expectCode(() => canonicalize("convax://user@canvas/path"), "INVALID_CHARACTER")
    expectCode(() => canonicalize("convax:///path"), "AUTHORITY_REQUIRED")
  })

  test("enforces raw component, total URI, and query item bounds before allocation", () => {
    expectCode(() => canonicalize(`convax://canvas/${"a".repeat(8 * 1024 + 1)}`), "COMPONENT_TOO_LONG")
    expectCode(() => canonicalize(`convax://${"a".repeat(8 * 1024)}/${"b".repeat(8 * 1024)}`), "URI_TOO_LONG")
    expectCode(
      () => canonicalize(`convax://canvas/value?${Array.from({ length: 65 }, (_, index) => `k${index}=v`).join("&")}`),
      "TOO_MANY_QUERY_ITEMS",
    )
  })

  test("keeps generic repeated query keys but orders the repeated-key list canonically", () => {
    expect(canonicalize("convax://canvas/node?tag=b&tag=a")).toBe("convax://canvas/node?tag=a&tag=b")
  })

  test("supports immutable from, with, serialization, and canonical equality", () => {
    const uri = from({ scheme: "CONVAX", authority: "CANVAS", path: "/main", query: "b=2&a=1", fragment: "" })
    expect(uri).toBeInstanceOf(ConvaxUri)
    expect(uri.toString()).toBe("convax://canvas/main?a=1&b=2")
    expect(uri.with({ path: "/next" }).toString()).toBe("convax://canvas/next?a=1&b=2")
    expect(equals(uri, "CONVAX://CANVAS/main?b=2&a=1")).toBeTrue()
    expect(uri.toJSON()).toEqual({
      scheme: "convax",
      authority: "canvas",
      path: "/main",
      query: "a=1&b=2",
      fragment: "",
    })
  })

  test("keeps component boundaries closed when constructing or changing a URI", () => {
    const base = parse("convax://canvas/main?mode=edit")
    expectCode(
      () => from({ scheme: "convax", authority: "canvas", path: "main", query: "", fragment: "" }),
      "INVALID_PATH",
    )
    expectCode(
      () => from({ scheme: "convax", authority: "canvas/other", path: "/main", query: "", fragment: "" }),
      "INVALID_AUTHORITY",
    )
    expectCode(
      () => from({ scheme: "convax", authority: "canvas", path: "/main?admin=true", query: "", fragment: "" }),
      "INVALID_PATH",
    )
    expectCode(
      () => from({ scheme: "convax", authority: "canvas", path: "/main", query: "mode=edit#admin", fragment: "" }),
      "INVALID_QUERY",
    )
    expectCode(() => base.with({ authority: "canvas#other" }), "INVALID_AUTHORITY")
    expectCode(
      () => from({ scheme: "convax://attacker", authority: "canvas", path: "/main", query: "", fragment: "" }),
      "INVALID_SCHEME",
    )
    expectCode(() => base.with({ fragment: "preview#attacker" }), "INVALID_CHARACTER")

    for (const authority of ["canvas%2Fother", "canvas%3Fadmin", "canvas%23fragment"]) {
      expectCode(
        () => from({ scheme: "convax", authority, path: "/main", query: "", fragment: "" }),
        "INVALID_AUTHORITY",
      )
    }
    expect(
      from({
        scheme: "convax",
        authority: "canvas",
        path: "/node%3Fadmin%3Dtrue%23fragment",
        query: "next=%26admin%3Dtrue%23fragment",
        fragment: "",
      }).toString(),
    ).toBe("convax://canvas/node%3Fadmin%3Dtrue%23fragment?next=%26admin%3Dtrue%23fragment")
    for (const key of ["authority", "path", "query", "fragment"] as const) {
      const components = {
        scheme: "convax",
        authority: "canvas",
        path: "/main",
        query: "",
        fragment: "",
        [key]: `${key === "path" ? "/" : ""}${String.fromCharCode(0xd800)}`,
      }
      expect(() => from(components)).toThrow(UriParseError)
    }
  })

  test("round-trips noncanonical input through one canonical component representation", () => {
    const canonical = canonicalize("CONVAX://CANVAS/caf%C3%A9/%7e?z=%2f&a=%65%CC%81")
    expect(canonical).toBe("convax://canvas/caf%C3%A9/~?a=%C3%A9&z=%2F")
    const parsed = parse(canonical)
    expect(from(parsed.toJSON()).toString()).toBe(canonical)
    expect(canonicalize(parsed.toString())).toBe(canonical)
  })

  test("preserves encoded separators inside opaque path segments", () => {
    const uri = parse("convax://canvas/canvas/node/plugin%2Ffolder%3Aitem")
    expect(uri.path).toBe("/canvas/node/plugin%2Ffolder%3Aitem")
    expect(uri.pathSegments).toEqual(["canvas", "node", "plugin/folder:item"])
    expect(Object.isFrozen(uri.pathSegments)).toBeTrue()
  })
})

describe("convax-project URI grammar", () => {
  test("builds and parses stable entry, path hint, and immutable blob revision", () => {
    const uri = fromProjectUri({ projectId, projectEpoch: epoch, entryId: fileId, path: "Generated/clip.mp4", blob })
    expect(uri.toString()).toBe(
      `convax-project://${projectId}/epochs/${epoch}/entries/${fileId}?blob=sha256%3A${"a".repeat(64)}&path=Generated%2Fclip.mp4`,
    )
    expect(parseProjectUri(uri)).toEqual({
      projectId,
      projectEpoch: epoch,
      entryId: fileId,
      path: "Generated/clip.mp4",
      blob,
    })
  })

  test("keeps Project authority opaque and rejects percent/case aliases", () => {
    const path = `/epochs/${epoch}/entries/${fileId}`
    expectCode(() => canonicalize(`convax-project://Project_one${path}`), "INVALID_PROJECT_ID")
    expectCode(() => canonicalize(`convax-project://project%5Fone${path}`), "INVALID_PROJECT_ID")
    expectCode(() => canonicalize(`convax-project://pr%C3%B6ject${path}`), "INVALID_PROJECT_ID")
  })

  test("rejects duplicate, unknown, invalid blob, fragment, and noncanonical query forms", () => {
    const base = `convax-project://${projectId}/epochs/${epoch}/entries/${fileId}`
    expectCode(() => canonicalize(`${base}?path=a&path=b`), "DUPLICATE_QUERY_KEY")
    expectCode(() => canonicalize(`${base}?revision=x`), "INVALID_QUERY")
    expectCode(() => canonicalize(`${base}?blob=sha256%3AABC`), "INVALID_BLOB_DIGEST")
    expectCode(() => canonicalize(`${base}#preview`), "FRAGMENT_FORBIDDEN")
    expectCode(() => parse(`${base}?path=Generated/clip.mp4`), "NON_CANONICAL")
    expectCode(
      () =>
        fromProjectUri({
          projectId,
          projectEpoch: epoch,
          entryId: fileId,
          path: `Generated/${String.fromCharCode(0xd800)}.mp4`,
        }),
      "INVALID_UTF8",
    )
  })

  test("validates entry identity lexically without defining or allocating its opaque type", () => {
    expect(isProjectEntryIdLexicallyValid(fileId)).toBeTrue()
    expect(isProjectEntryIdLexicallyValid(directoryId)).toBeTrue()
    expect(classifyProjectEntryId(fileId)).toBe("file")
    expect(classifyProjectEntryId(directoryId)).toBe("directory")
    expect(classifyProjectEntryId(`pf_${"A".repeat(64)}`)).toBeNull()
  })

  test("requires callers to select explicit Project comparison semantics", () => {
    const first = fromProjectUri({ projectId, projectEpoch: epoch, entryId: fileId, path: "a.md", blob })
    const renamed = fromProjectUri({ projectId, projectEpoch: epoch, entryId: fileId, path: "b.md", blob })
    const changed = fromProjectUri({
      projectId,
      projectEpoch: epoch,
      entryId: fileId,
      path: "b.md",
      blob: `sha256:${"b".repeat(64)}`,
    })
    expect(equalsProjectUri(first, renamed, "entry")).toBeTrue()
    expect(equalsProjectUri(first, renamed, "entry-revision")).toBeTrue()
    expect(equalsProjectUri(first, renamed, "canonical-string")).toBeFalse()
    expect(equalsProjectUri(first, changed, "entry")).toBeTrue()
    expect(equalsProjectUri(first, changed, "entry-revision")).toBeFalse()
  })
})
