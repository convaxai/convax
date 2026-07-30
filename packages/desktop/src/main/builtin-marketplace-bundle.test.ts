import { describe, expect, test } from "bun:test"
import { canonicalJson, sha256Hex } from "@convax/marketplace"

import {
  reserveBuiltinCapabilities,
  builtinMarketplaceReservation,
  verifyBuiltinBundleReservation,
  type BuiltinMarketplaceEarlyReservation,
} from "./builtin-marketplace-bundle"

const reservation: BuiltinMarketplaceEarlyReservation = {
  members: [{ id: "canvas-storyboard", kind: "skill" }],
  schema: "convax.builtin-reservation/1",
}

function manifest(id = "canvas-storyboard") {
  const members = [
    {
      artifact: { path: "members/canvas-storyboard.zip", sha256: "a".repeat(64), size: 10 },
      id,
      kind: "skill" as const,
      presentation: {
        poster: { mime: "image/png", path: "members/canvas-storyboard.png", sha256: "b".repeat(64), size: 20 },
      },
      version: "1.0.0",
    },
  ]
  return {
    members,
    release: { id: sha256Hex(canonicalJson(members)) },
    schema: "convax.builtin-bundle/1",
  }
}

describe("Builtin Marketplace early reservation", () => {
  test("imports the compiled reservation before any packaged bytes are opened", () => {
    expect(builtinMarketplaceReservation as BuiltinMarketplaceEarlyReservation).toEqual(reservation)
  })
  test("keeps the generated identity reserved before a damaged outer bundle can be parsed", () => {
    expect(reserveBuiltinCapabilities(reservation)).toEqual([
      { availability: "checking-builtin-bundle", id: "canvas-storyboard", kind: "skill" },
    ])
    expect(() => verifyBuiltinBundleReservation({ schema: "damaged" }, reservation)).toThrow()
  })

  test("accepts the parsed bundle only when membership matches the generated reservation in both directions", () => {
    expect(verifyBuiltinBundleReservation(manifest(), reservation).members.map(({ id }) => id)).toEqual([
      "canvas-storyboard",
    ])
    expect(() => verifyBuiltinBundleReservation(manifest("unexpected"), reservation)).toThrow("exactly match")
    const extraMembers = [
      ...manifest().members,
      {
        ...manifest("extra").members[0],
        artifact: { path: "members/extra.zip", sha256: "c".repeat(64), size: 10 },
        id: "extra",
        presentation: {
          poster: { mime: "image/png", path: "members/extra.png", sha256: "d".repeat(64), size: 20 },
        },
      },
    ]
    expect(() =>
      verifyBuiltinBundleReservation(
        {
          ...manifest(),
          members: extraMembers,
          release: { id: sha256Hex(canonicalJson(extraMembers)) },
        },
        reservation,
      ),
    ).toThrow("exactly match")
  })
})
