import { parseBuiltinBundle, type BuiltinBundle } from "@convax/marketplace"
import { builtinMarketplaceReservation } from "../generated/builtin-marketplace-reservation"

export { builtinMarketplaceReservation }

export interface BuiltinMarketplaceEarlyReservation {
  members: readonly {
    id: string
    kind: "plugin" | "skill"
  }[]
  schema: "convax.builtin-reservation/1"
}

export interface ReservedBuiltinCapability {
  id: string
  kind: "plugin" | "skill"
  availability: "checking-builtin-bundle"
}

function identity(value: { id: string; kind: "plugin" | "skill" }) {
  return `${value.kind}\0${value.id}`
}

function validateReservation(value: BuiltinMarketplaceEarlyReservation) {
  if (
    value.schema !== "convax.builtin-reservation/1" ||
    !Array.isArray(value.members) ||
    value.members.length === 0 ||
    value.members.length > 128
  ) {
    throw new Error("Builtin early reservation is invalid")
  }
  const identities = new Set<string>()
  for (const member of value.members) {
    if (
      !member ||
      (member.kind !== "plugin" && member.kind !== "skill") ||
      typeof member.id !== "string" ||
      member.id.length < 1 ||
      member.id.length > 200
    ) {
      throw new Error("Builtin early reservation is invalid")
    }
    const key = identity(member)
    if (identities.has(key)) throw new Error("Builtin early reservation repeats an identity")
    identities.add(key)
  }
  return identities
}

/**
 * Reserves Builtin identities before any outer ZIP parsing. The generated table
 * carries no bytes, version, trust, setup, or execution authority.
 */
export function reserveBuiltinCapabilities(
  reservation: BuiltinMarketplaceEarlyReservation,
): readonly ReservedBuiltinCapability[] {
  validateReservation(reservation)
  return reservation.members.map((member) => ({
    availability: "checking-builtin-bundle",
    id: member.id,
    kind: member.kind,
  }))
}

/**
 * Strictly parses the locked bundle manifest and requires an exact bidirectional
 * identity match with the build-generated early reservation.
 */
export function verifyBuiltinBundleReservation(
  manifest: unknown,
  reservation: BuiltinMarketplaceEarlyReservation,
): BuiltinBundle {
  const expected = validateReservation(reservation)
  const bundle = parseBuiltinBundle(manifest)
  const actual = new Set(bundle.members.map(identity))
  if (
    expected.size !== actual.size ||
    [...expected].some((member) => !actual.has(member)) ||
    [...actual].some((member) => !expected.has(member))
  ) {
    throw new Error("Builtin bundle members do not exactly match the compiled early reservation")
  }
  return bundle
}
