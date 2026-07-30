import { expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { checkMarketplace } from "@convax/marketplace-kit"
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
  const packageRoot = join(root, "packages/mcp-servers/example-mcp")
  expect(await stat(join(packageRoot, "package/server.json"))).toBeTruthy()
  expect(JSON.parse(await readFile(join(packageRoot, "convax-package.json"), "utf8"))).toMatchObject({
    schema: "convax.package/2",
    kind: "mcp-server",
  })
  expect(await stat(join(root, "packages/plugins")).catch(() => undefined)).toBeUndefined()
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  expect(Object.keys(packageJson.devDependencies)).toEqual(["@convax/marketplace-kit"])
  const workflow = await readFile(join(root, ".github/workflows/check.yml"), "utf8")
  expect(workflow).not.toContain("pull_request_target")
  expect(workflow).not.toContain("microvoid/convax-plugins")
  expect(workflow).toContain("permissions:")
})

test("scaffolds a Plugin starter accepted by the shared plugin/8 SDK parser", async () => {
  const parent = await mkdtemp(join(tmpdir(), "create-convax-plugin-marketplace-"))
  const root = join(parent, "market")
  await create({
    directory: root,
    id: "example-plugin-market",
    name: "Example Plugin Market",
    owner: "example",
    repository: "plugin-market",
    starter: "plugin",
  })

  await checkMarketplace(root)
  expect(
    JSON.parse(
      await readFile(
        join(root, "packages/plugins/example-plugin/package/manifest.json"),
        "utf8",
      ),
    ),
  ).toMatchObject({
    hostApi: { required: ["host.context.get"] },
    schema: "convax.plugin/8",
  })
})
