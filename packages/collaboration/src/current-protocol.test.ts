import { describe, expect, test } from "bun:test"

import {
  CURRENT_PROTOCOL_DESCRIPTOR_FORMAT,
  currentProtocolDescriptor,
  encodeCurrentProtocolDescriptor,
  installCurrentProtocolAuthority,
  parseCurrentProtocolDescriptor,
} from "./current-protocol"
import { CAUSAL_EDIT_MAGIC, KERNEL_DIGEST_DOMAINS } from "./constants"

const packagedDescriptor = new Uint8Array(
  await Bun.file(new URL("../protocol/current.json", import.meta.url)).arrayBuffer(),
)

describe("current protocol descriptor", () => {
  test("recomputes deterministically from the owner schema constants", () => {
    const descriptor = currentProtocolDescriptor()

    expect(descriptor.format).toBe(CURRENT_PROTOCOL_DESCRIPTOR_FORMAT)
    expect(descriptor.frameMagic).toBe(CAUSAL_EDIT_MAGIC)
    expect(descriptor.typedIntentFormat).toBe(KERNEL_DIGEST_DOMAINS.typedIntent)
    expect(descriptor.artifacts.map(({ name }) => name)).toEqual([
      "canvas-schema",
      "collaboration-kernel",
      "control-plane",
      "project-persistence",
    ])
    expect(descriptor.digestDomains).toHaveLength(127)
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(currentProtocolDescriptor()).toBe(descriptor)
    expect(encodeCurrentProtocolDescriptor()).toEqual(encodeCurrentProtocolDescriptor())
  })

  test("equals the generated descriptor committed for packaging", () => {
    expect([...packagedDescriptor]).toEqual([...encodeCurrentProtocolDescriptor()])
    expect(parseCurrentProtocolDescriptor(packagedDescriptor)).toBe(currentProtocolDescriptor())
  })

  test("rejects drifted, truncated, and re-encoded descriptor bytes", () => {
    const drifted = Uint8Array.from(packagedDescriptor)
    drifted[10] ^= 1

    for (const candidate of [drifted, packagedDescriptor.slice(0, -1), new Uint8Array(0)]) {
      expect(() => parseCurrentProtocolDescriptor(candidate)).toThrow()
    }
    expect(() => parseCurrentProtocolDescriptor(packagedDescriptor)).not.toThrow()
  })

  test("installs one capability bound to the built protocol digest", () => {
    const authority = installCurrentProtocolAuthority()

    expect(String(authority.protocolDigest)).toBe(String(currentProtocolDescriptor().protocolDigest))
    expect(installCurrentProtocolAuthority()).toBe(authority)
    expect(() => installCurrentProtocolAuthority({ ...currentProtocolDescriptor() })).toThrow()
  })
})
