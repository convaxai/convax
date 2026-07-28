import { expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { create } from "./index"

test("scaffolds one starter with hardened workflows and no official hardcoding", async () => {
  const parent = await mkdtemp(join(tmpdir(), "create-convax-marketplace-"))
  const root = join(parent, "market")
  await create({
    directory: root,
    id: "example-market",
    name: "Example Market",
    owner: "example",
    repository: "market",
    starter: "mcp-server",
  })
  expect(await stat(join(root, "packages/mcp-servers/example-mcp/server.json"))).toBeTruthy()
  expect(await stat(join(root, "packages/plugins")).catch(() => undefined)).toBeUndefined()
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  expect(Object.keys(packageJson.devDependencies)).toEqual(["@convax/marketplace-kit"])
  const workflow = await readFile(join(root, ".github/workflows/check.yml"), "utf8")
  expect(workflow).not.toContain("pull_request_target")
  expect(workflow).not.toContain("microvoid/convax-plugins")
  expect(workflow).toContain("permissions:")
})
