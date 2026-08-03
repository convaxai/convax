import { expect, test } from "bun:test"

test("production API source contains no retired v1 edit-order implementation", async () => {
  const files = [
    "src/contracts.ts",
    "src/metadata-store.ts",
    "src/payload-policy.ts",
    "src/service.ts",
  ]
  const retired = [
    "AdmissionCertificateV1",
    "ActorCounterAbandonmentV1",
    "DocumentMmrServiceRecordV1",
    "OperationLookupRequestV1",
    "convax.admission-certificate/1",
    "convax.member-session-proof/1",
  ]
  for (const file of files) {
    const source = await Bun.file(new URL(`../${file}`, import.meta.url)).text()
    for (const token of retired) expect(source.includes(token), `${file} contains ${token}`).toBeFalse()
  }
})
