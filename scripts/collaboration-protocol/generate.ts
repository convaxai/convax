import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME,
  encodeCurrentProtocolDescriptor,
} from "../../packages/collaboration/src/current-protocol"

/**
 * Emits the single current protocol descriptor from the owner schema constants.
 * It reads no authority release, pointer, or archived review directory.
 */
export const CURRENT_PROTOCOL_DESCRIPTOR_RELATIVE_PATH =
  `packages/collaboration/protocol/${CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME}`

export function generateCurrentProtocolDescriptorBytes(): Uint8Array {
  return encodeCurrentProtocolDescriptor()
}

export async function verifyCurrentProtocolDescriptorFile(repositoryRoot: string): Promise<void> {
  const target = join(repositoryRoot, CURRENT_PROTOCOL_DESCRIPTOR_RELATIVE_PATH)
  const expected = generateCurrentProtocolDescriptorBytes()
  const actual = new Uint8Array(await readFile(target).catch(() => {
    throw new Error(`${CURRENT_PROTOCOL_DESCRIPTOR_RELATIVE_PATH} is missing; run bun scripts/collaboration-protocol/generate.ts`)
  }))
  if (actual.byteLength !== expected.byteLength || actual.some((byte, index) => byte !== expected[index])) {
    throw new Error(`${CURRENT_PROTOCOL_DESCRIPTOR_RELATIVE_PATH} differs from the generated current protocol descriptor`)
  }
}

if (import.meta.main) {
  const repositoryRoot = join(import.meta.dir, "..", "..")
  if (process.argv.includes("--check")) {
    await verifyCurrentProtocolDescriptorFile(repositoryRoot)
    console.log(`current protocol descriptor is up to date: ${CURRENT_PROTOCOL_DESCRIPTOR_RELATIVE_PATH}`)
  } else {
    await writeFile(
      join(repositoryRoot, CURRENT_PROTOCOL_DESCRIPTOR_RELATIVE_PATH),
      generateCurrentProtocolDescriptorBytes(),
      { mode: 0o644 },
    )
    console.log(`wrote ${CURRENT_PROTOCOL_DESCRIPTOR_RELATIVE_PATH}`)
  }
}
