import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeBase64urlV2,
  ordinarySha256V2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  type DigestV2,
} from "@convax/collaboration"
import { deriveObjectNativeKeyV2 } from "./native-store-keys"
import { ProjectRemoteIngressCowMapV2, type RemoteIngressEvidenceMapLeafEntryV2 } from "./remote-ingress-cow-map"

const roots: string[] = []
const projectId = parseProjectIdV2("project-a")
const projectEpoch = id(1)

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

describe.skipIf(process.platform === "win32")("Project remote-ingress COW74 map real-filesystem durability", () => {
  test("publishes and reopens the exact empty root", async () => {
    const fixture = await open("stable-key-state")
    const published = await fixture.map.publish([], "0" as never)
    expect(published.record).toMatchObject({ entryCount: "0", rootPageDigest: null, treeHeight: "0" })
    expect((await fixture.map.load(published.digest)).entries).toEqual([])
  })

  test("splits leaf overflow 129 as 64/65 and validates every child commitment", async () => {
    const fixture = await open("stable-key-state")
    const published = await fixture.map.publish(stableEntries(129), "1" as never)
    expect(published.record).toMatchObject({ entryCount: "129", treeHeight: "1" })
    const rootPage = await page(fixture.admission, "stable-key-state", published.record.rootPageDigest!) as { children: { childPageRecordDigest: DigestV2 }[] }
    expect(rootPage.children).toHaveLength(2)
    const sizes = await Promise.all(rootPage.children.map(async (child) => ((await page(fixture.admission, "stable-key-state", child.childPageRecordDigest)) as { entries: unknown[] }).entries.length))
    expect(sizes).toEqual([64, 65])
    expect((await fixture.map.load(published.digest)).entries).toHaveLength(129)
  })

  test("admits an exact 74-child internal page and splits before 75", async () => {
    const fixture = await open("member-quota")
    const full = await fixture.map.publish(memberEntries(74 * 128), "1" as never)
    expect(String(full.record.treeHeight)).toBe("1")
    const fullRoot = await page(fixture.admission, "member-quota", full.record.rootPageDigest!) as { children: unknown[] }
    expect(fullRoot.children).toHaveLength(74)

    const split = await fixture.map.publish(memberEntries(74 * 128 + 1), "2" as never)
    expect(String(split.record.treeHeight)).toBe("2")
    const splitRoot = await page(fixture.admission, "member-quota", split.record.rootPageDigest!) as { children: { childPageRecordDigest: DigestV2 }[] }
    expect(splitRoot.children).toHaveLength(2)
    const widths = await Promise.all(splitRoot.children.map(async (child) => ((await page(fixture.admission, "member-quota", child.childPageRecordDigest)) as { children: unknown[] }).children.length))
    expect(widths).toEqual([37, 38])
    expect((await fixture.map.load(split.digest)).entries).toHaveLength(74 * 128 + 1)
  }, 30_000)
})

async function open(mapKind: "stable-key-state" | "member-quota") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-cow74-"))
  roots.push(root)
  const admission = path.join(root, "remote-ingress-evidence-admission")
  return { admission, map: await ProjectRemoteIngressCowMapV2.open({ admissionDirectory: admission, projectId, projectEpoch, mapKind }) }
}

function stableEntries(count: number): RemoteIngressEvidenceMapLeafEntryV2[] {
  return Array.from({ length: count }, (_, index) => {
    const sourceMemberId = parseMemberIdV2(id((index % 250) + 2))
    const transferId = idFromInteger(index)
    return Object.freeze({
      mapKind: "stable-key-state" as const,
      keyDigest: digest(`stable:${index}`),
      stableKey: Object.freeze({ projectId, projectEpoch, sourceMemberId, transferId }),
      valueRecordDigest: digest(`value:${index}`),
    })
  })
}

function memberEntries(count: number): RemoteIngressEvidenceMapLeafEntryV2[] {
  return Array.from({ length: count }, (_, index) => Object.freeze({
    mapKind: "member-quota" as const,
    keyDigest: digest(`member:${index}`),
    sourceMemberId: parseMemberIdV2(idFromInteger(index)),
    valueRecordDigest: digest(`quota:${index}`),
  }))
}

async function page(admission: string, mapKind: string, digest: DigestV2): Promise<unknown> {
  const target = path.join(admission, "maps", mapKind, "pages", `${deriveObjectNativeKeyV2("remote-ingress-map-page", digest)}.bin`)
  return decodeRestrictedJcsV2(await fs.readFile(target))
}

function digest(seed: string) { return ordinarySha256V2(new TextEncoder().encode(seed)) }
function id(fill: number) { return parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(fill))) }
function idFromInteger(value: number) {
  const bytes = new Uint8Array(16)
  new DataView(bytes.buffer).setBigUint64(8, BigInt(value + 1), false)
  return parseId128V2(encodeBase64urlV2(bytes))
}
