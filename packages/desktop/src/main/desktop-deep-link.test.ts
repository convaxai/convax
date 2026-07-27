import { describe, expect, test } from "bun:test"

import { findDesktopDeepLink, parseDesktopDeepLink } from "./desktop-deep-link"

describe("Desktop deep links", () => {
  test("parses only the bounded service authorization activation route", () => {
    expect(
      parseDesktopDeepLink("convax://service-authorization/complete?authorization_id=authorize_0123456789abcdef"),
    ).toEqual({
      authorizationId: "authorize_0123456789abcdef",
      kind: "service-authorization-complete",
    })
    expect(
      findDesktopDeepLink([
        "/Applications/Convax.app",
        "--flag",
        "convax://service-authorization/complete?authorization_id=authorize_0123456789abcdef",
      ]),
    ).toEqual({
      authorizationId: "authorize_0123456789abcdef",
      kind: "service-authorization-complete",
    })
  })

  test("rejects authority, extra fields, fragments, secrets and unrelated Convax URIs", () => {
    const rejected = [
      "convax://service-authorization/complete",
      "convax://service-authorization/complete?authorization_id=short",
      "convax://service-authorization/complete?authorization_id=authorize_0123456789abcdef&code=secret",
      "convax://service-authorization/complete?authorization_id=authorize_0123456789abcdef#token",
      "convax://user:password@service-authorization/complete?authorization_id=authorize_0123456789abcdef",
      "convax://service-authorization/other?authorization_id=authorize_0123456789abcdef",
      "convax://canvas/resource?authorization_id=authorize_0123456789abcdef",
      "https://service-authorization/complete?authorization_id=authorize_0123456789abcdef",
    ]

    for (const value of rejected) expect(parseDesktopDeepLink(value)).toBeUndefined()
  })
})
