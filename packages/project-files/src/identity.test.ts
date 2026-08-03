import { describe, expect, test } from "bun:test"
import {
  InvalidProjectIdentityError,
  isProjectDirectoryId,
  isProjectEntryId,
  isProjectFileId,
  isProjectVersionId,
  parseProjectDirectoryId,
  parseProjectEntryId,
  parseProjectFileId,
  parseProjectVersionId,
} from "./identity"

const digest = "a".repeat(64)

describe("Project opaque identity codec", () => {
  test("accepts the four closed identity families", () => {
    expect(parseProjectFileId(`pf_${digest}`)).toBe(`pf_${digest}`)
    expect(parseProjectDirectoryId(`pd_${digest}`)).toBe(`pd_${digest}`)
    expect(parseProjectEntryId(`pf_${digest}`)).toBe(`pf_${digest}`)
    expect(parseProjectEntryId(`pd_${digest}`)).toBe(`pd_${digest}`)
    expect(parseProjectVersionId(`pv_${digest}`)).toBe(`pv_${digest}`)
  })

  test("rejects aliases, uppercase digests and wrong lengths", () => {
    for (const value of [
      `file_${digest}`,
      `pf_${digest.toUpperCase()}`,
      `pf_${digest.slice(1)}`,
      `pf_${digest}0`,
      `pf_${"g".repeat(64)}`,
      "",
      null,
    ]) {
      expect(isProjectFileId(value)).toBe(false)
      expect(() => parseProjectFileId(value)).toThrow(InvalidProjectIdentityError)
    }
  })

  test("does not confuse entry and version namespaces", () => {
    expect(isProjectEntryId(`pv_${digest}`)).toBe(false)
    expect(isProjectVersionId(`v_${digest}`)).toBe(false)
    expect(isProjectVersionId(`pf_${digest}`)).toBe(false)
    expect(isProjectDirectoryId(`pf_${digest}`)).toBe(false)
    expect(() => parseProjectVersionId(`pd_${digest}`)).toThrow(InvalidProjectIdentityError)
  })
})
