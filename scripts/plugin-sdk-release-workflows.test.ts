import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

type WorkflowJob = {
  readonly environment?: string
  readonly needs?: string
  readonly permissions?: Record<string, string>
  readonly steps?: readonly {
    readonly run?: string
    readonly uses?: string
    readonly with?: Record<string, unknown>
    readonly ["working-directory"]?: string
  }[]
}

type Workflow = {
  readonly jobs?: Record<string, WorkflowJob>
  readonly on?: {
    readonly workflow_dispatch?: {
      readonly inputs?: Record<string, unknown>
    }
  }
  readonly permissions?: Record<string, string>
}

const repositoryRoot = resolve(import.meta.dir, "..")
const policies = [
  {
    path: ".github/workflows/plugin-sdk-bootstrap.yml",
    privilegedJob: "sign",
    needs: "build",
    permissions: { contents: "read", "id-token": "write" },
  },
  {
    path: ".github/workflows/plugin-sdk-npm-stage.yml",
    privilegedJob: "stage",
    needs: "build",
    permissions: { contents: "read", "id-token": "write" },
  },
  {
    path: ".github/workflows/plugin-sdk-release.yml",
    privilegedJob: "publish",
    needs: "verify",
    permissions: { contents: "write", "id-token": "write" },
  },
] as const

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isWorkflow(value: unknown): value is Workflow {
  return isRecord(value) && isRecord(value.jobs) && Object.values(value.jobs).every(isRecord)
}

function exactObject(actual: Record<string, string> | undefined, expected: Record<string, string>): void {
  expect(actual).toEqual(expected)
}

describe("Plugin SDK publication workflow privilege boundary", () => {
  for (const policy of policies) {
    test(`${policy.path} keeps the privileged job artifact-only`, async () => {
      const source = await readFile(resolve(repositoryRoot, policy.path), "utf8")
      const parsed: unknown = Bun.YAML.parse(source)
      expect(isWorkflow(parsed)).toBe(true)
      if (!isWorkflow(parsed)) throw new TypeError(`${policy.path} is not one workflow object`)
      const workflow = parsed
      expect(workflow.permissions).toEqual({ contents: "read" })
      expect(workflow.on?.workflow_dispatch).toBeDefined()
      expect(workflow.on?.workflow_dispatch?.inputs).not.toHaveProperty("commit")

      const job = workflow.jobs?.[policy.privilegedJob]
      const unprivilegedJob = workflow.jobs?.[policy.needs]
      expect(job).toBeDefined()
      expect(unprivilegedJob).toBeDefined()
      expect(unprivilegedJob?.permissions).toBeUndefined()
      expect(job?.needs).toBe(policy.needs)
      expect(job?.environment).toBeUndefined()
      exactObject(job?.permissions, policy.permissions)

      for (const candidateJob of Object.values(workflow.jobs ?? {})) {
        for (const step of candidateJob.steps ?? []) {
          if (!step.uses) continue
          expect(step.uses).toMatch(/^[^@\s]+@[a-f0-9]{40}$/u)
          if (step.uses.startsWith("actions/checkout@")) {
            expect(candidateJob).toBe(unprivilegedJob)
            expect(step.with?.["persist-credentials"]).toBe(false)
          }
        }
      }

      const steps = job?.steps ?? []
      expect(steps.length).toBeGreaterThan(0)
      const cosignInstaller = steps.find((step) => step.uses?.startsWith("sigstore/cosign-installer@"))
      expect(cosignInstaller?.uses).toBe("sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6")
      expect(cosignInstaller?.with?.["cosign-release"]).toBe("v3.0.6")
      expect(steps.some((step) => step.uses?.startsWith("actions/attest@"))).toBe(false)
      const privilegedShell = steps
        .map((step) => step.run ?? "")
        .filter(Boolean)
        .join("\n")
      expect(privilegedShell).toContain("tar -xOzf")
      expect(privilegedShell).toContain("package/package.json")
      expect(privilegedShell).toContain("sha256sum")
      expect(privilegedShell).toContain("openssl dgst -sha512")
      expect(privilegedShell).toContain(
        'keys == ["checks", "dependencies", "host", "package", "profile", "schema", "sigstore", "workflow"]',
      )
      expect(privilegedShell).toContain("cosign sign-blob")
      expect(privilegedShell).toContain("cosign verify-blob")
      expect(privilegedShell).toContain("--bundle")
      expect(privilegedShell).toContain("--certificate-identity")
      expect(privilegedShell).toContain("--certificate-oidc-issuer")
      expect(privilegedShell).toContain("--certificate-github-workflow-name")
      expect(privilegedShell).toContain("--certificate-github-workflow-ref")
      expect(privilegedShell).toContain("--certificate-github-workflow-repository")
      expect(privilegedShell).toContain("--certificate-github-workflow-sha")
      expect(privilegedShell).toContain("--certificate-github-workflow-trigger")
      expect(privilegedShell).toContain("application/vnd.dev.sigstore.bundle.v0.3+json")
      expect(privilegedShell).toContain("inclusionPromise.signedEntryTimestamp")
      expect(privilegedShell).toContain("inclusionProof.rootHash")
      expect(privilegedShell).not.toMatch(
        /--(?:insecure-ignore-sct|insecure-ignore-tlog|private-infrastructure|skip-confirmation|use-signed-timestamps)/u,
      )
      expect(privilegedShell).toContain('test "$GITHUB_REPOSITORY_ID" = "$REPOSITORY_ID"')
      expect(privilegedShell).toContain('test "$GITHUB_REPOSITORY_OWNER_ID" = "$REPOSITORY_OWNER_ID"')
      expect(source).toContain('--repository-id "$GITHUB_REPOSITORY_ID"')
      expect(source).toContain('--repository-owner-id "$GITHUB_REPOSITORY_OWNER_ID"')
      expect(source).not.toContain("--run-id")
      expect(source).not.toContain("--run-attempt")
      expect(source).not.toContain("GITHUB_RUN_ID")
      expect(source).not.toContain("GITHUB_RUN_ATTEMPT")
      expect(source).not.toContain("attestations: write")
      expect(source).not.toContain("CONVAX_PRIVATE_ATTESTATIONS_ENABLED")
      for (const step of steps) {
        expect(step["working-directory"]).toBeUndefined()
        if (step.uses) {
          expect(step.uses).not.toContain("actions/checkout")
        }
        if (step.run) {
          expect(step.run).not.toMatch(
            /(?:^|[\n;&|`]|\$\()\s*(?:bash|bun|deno|git|node|perl|python[0-9.]*|ruby|sh|source|zsh)\b/u,
          )
          expect(step.run).not.toMatch(/(?:^|[\s"'`])(?:\.\.?\/|packages\/|scripts\/)/u)
          expect(step.run).not.toMatch(/\bnpm\s+(?:exec|pack|run|test)\b/u)
        }
      }
    })
  }

  test("the final release binds npm SDK bytes to a source-reproduced package", async () => {
    const source = await readFile(resolve(repositoryRoot, ".github/workflows/plugin-sdk-release.yml"), "utf8")
    expect(source).toContain('source_pack="$RUNNER_TEMP/plugin-sdk-release-source-pack"')
    expect(source).toContain("bun pm pack")
    expect(source).toContain('cmp "$source_sdk_tarball" "${{ steps.npm.outputs.sdk_tarball }}"')
    expect(source).toContain('--sdk-source-tarball "$source_sdk_tarball"')
  })

  test("private-repository npm publication is stage-only and does not claim native npm provenance", async () => {
    const source = await readFile(resolve(repositoryRoot, ".github/workflows/plugin-sdk-npm-stage.yml"), "utf8")
    expect(source).toContain('NPM_CONFIG_PROVENANCE: "false"')
    expect(source).toContain("npm stage publish")
    expect(source).toContain("--provenance=false")
    expect(source).not.toMatch(/\bnpm publish\b/u)
    expect(source).not.toContain("CONVAX_PRIVATE_NPM_PUBLISHING_ENABLED")
  })

  test("the release combines immutable assets with Sigstore and re-verifies published bytes", async () => {
    const source = await readFile(resolve(repositoryRoot, ".github/workflows/plugin-sdk-release.yml"), "utf8")
    expect(source).toContain('verify_bundle "$existing/$asset" "$existing/$asset.sigstore.json"')
    expect(source).toContain('verify_bundle "$published/$asset" "$published/$asset.sigstore.json"')
    expect(source).toContain('cmp "$published/$asset" "$evidence/$asset"')
    expect(source).toContain("expected_assets=")
    expect(source).toContain("CONVAX_IMMUTABLE_RELEASES_ENABLED")
    expect(source).toContain("repos/$REPOSITORY/immutable-releases")
    expect(source).toContain("gh release verify")
    expect(source).toContain("gh release verify-asset")
  })
})
