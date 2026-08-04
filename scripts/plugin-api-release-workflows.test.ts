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
    path: ".github/workflows/plugin-api-bootstrap.yml",
    privilegedJob: "sign",
    needs: "build",
    permissions: { contents: "read", "id-token": "write" },
  },
  {
    path: ".github/workflows/plugin-api-npm-stage.yml",
    privilegedJob: "stage",
    needs: "build",
    permissions: { contents: "read", "id-token": "write" },
  },
  {
    path: ".github/workflows/plugin-api-release.yml",
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

describe("Plugin API publication workflow privilege boundary", () => {
  for (const policy of policies) {
    test(`${policy.path} keeps the privileged job artifact-only`, async () => {
      const source = await readFile(resolve(repositoryRoot, policy.path), "utf8")
      const parsed: unknown = Bun.YAML.parse(source)
      expect(isWorkflow(parsed)).toBe(true)
      if (!isWorkflow(parsed)) throw new TypeError(`${policy.path} is not one workflow object`)
      expect(parsed.permissions).toEqual({ contents: "read" })
      expect(parsed.on?.workflow_dispatch).toBeDefined()
      expect(parsed.on?.workflow_dispatch?.inputs).not.toHaveProperty("commit")

      const job = parsed.jobs?.[policy.privilegedJob]
      const unprivilegedJob = parsed.jobs?.[policy.needs]
      expect(job).toBeDefined()
      expect(unprivilegedJob).toBeDefined()
      expect(unprivilegedJob?.permissions).toBeUndefined()
      expect(job?.needs).toBe(policy.needs)
      expect(job?.environment).toBeUndefined()
      expect(job?.permissions).toEqual(policy.permissions)

      for (const candidateJob of Object.values(parsed.jobs ?? {})) {
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
        'keys == ["checks", "host", "pluginApi", "profile", "schema", "sigstore", "workflow"]',
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
        if (step.uses) expect(step.uses).not.toContain("actions/checkout")
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

  test("private-repository npm publication is stage-only and does not claim native npm provenance", async () => {
    const source = await readFile(resolve(repositoryRoot, ".github/workflows/plugin-api-npm-stage.yml"), "utf8")
    expect(source).toContain('NPM_CONFIG_PROVENANCE: "false"')
    expect(source).toContain("npm stage publish")
    expect(source).toContain("--provenance=false")
    expect(source).not.toMatch(/\bnpm publish\b/u)
    expect(source).not.toContain("CONVAX_PRIVATE_NPM_PUBLISHING_ENABLED")
  })

  test("the release combines immutable assets with Sigstore and re-verifies published bytes", async () => {
    const source = await readFile(resolve(repositoryRoot, ".github/workflows/plugin-api-release.yml"), "utf8")
    expect(source).toContain('verify_bundle "$existing/$asset" "$existing/$asset.sigstore.json"')
    expect(source).toContain('verify_bundle "$published/$asset" "$published/$asset.sigstore.json"')
    expect(source).toContain('cmp "$published/$asset" "$evidence/$asset"')
    expect(source).toContain('cmp "$published/$asset.sigstore.json" "$evidence/$asset.sigstore.json"')
    expect(source).toContain("expected_assets=")
    expect(source).toContain("CONVAX_IMMUTABLE_RELEASES_ENABLED")
    expect(source).toContain("repos/$REPOSITORY/immutable-releases")
    expect(source).toContain("gh release verify")
    expect(source).toContain("gh release verify-asset")
  })

  test("the publication guide describes the enforced private-repository trust model", async () => {
    const source = await readFile(resolve(repositoryRoot, "docs/plugin-api-release.md"), "utf8")
    expect(source).toContain("Cosign `v3.0.6`")
    expect(source).toContain("Public Rekor is a deliberate disclosure boundary")
    expect(source).toContain("repository id `1322708874`")
    expect(source).toContain("owner id `312877127`")
    expect(source).toContain("NPM_CONFIG_PROVENANCE=false npm publish")
    expect(source).toContain("npm stage publish --provenance=false")
    expect(source).toContain("gh release verify")
    expect(source).toContain("gh release verify-asset")
    expect(source).not.toContain("gh attestation")
    expect(source).not.toContain("CONVAX_PRIVATE_ATTESTATIONS_ENABLED")
    expect(source).not.toContain("CONVAX_PRIVATE_NPM_PUBLISHING_ENABLED")
  })
})
