import { describe, expect, test } from "bun:test"

import {
  generationLroMethods,
  normalizeGenerationRecoveryCapability,
  normalizeGenerationRecoverySnapshot,
  requireGenerationRecoveryRequest,
} from "./generation-recovery-protocol"

describe("Generic generation long-running operation protocol", () => {
  test("normalizes the exact all-or-nothing capability handshake", () => {
    expect(
      normalizeGenerationRecoveryCapability({
        binding: "account-binding-7c9e",
        mode: "long-running-operation",
        schema: "convax.generation-lro/1",
      }),
    ).toEqual({
      binding: "account-binding-7c9e",
      mode: "long-running-operation",
      schema: "convax.generation-lro/1",
    })
    expect(() =>
      normalizeGenerationRecoveryCapability({
        binding: "account-binding",
        lookup: true,
        mode: "long-running-operation",
        schema: "convax.generation-lro/1",
      }),
    ).toThrow("capability")
    expect(() =>
      normalizeGenerationRecoveryCapability({
        binding: "account-binding",
        mode: "operation-exactly-once",
        schema: "convax.generation-recovery/1",
      }),
    ).toThrow("capability")
  })

  test("validates fixed request identities without provider or path data", () => {
    expect(
      requireGenerationRecoveryRequest({
        operationId: "operation-one",
        requestDigest: "a".repeat(64),
        taskId: "task_123",
      }),
    ).toEqual({
      operationId: "operation-one",
      requestDigest: "a".repeat(64),
      schema: "convax.generation-lro-request/1",
      taskId: "task_123",
    })
    for (const taskId of ["https://provider.example/task/1", "/Users/me/task", "token:secret"]) {
      expect(() =>
        requireGenerationRecoveryRequest({
          operationId: "operation-one",
          requestDigest: "a".repeat(64),
          taskId,
        }),
      ).toThrow()
    }
    expect(
      requireGenerationRecoveryRequest(
        {
          operationId: "operation-one",
          outputDirectory: "/private/host-output",
          requestDigest: "a".repeat(64),
          resultDigest: "b".repeat(64),
          taskId: "task_123",
        },
        { allowOutputDirectory: true },
      ),
    ).toMatchObject({ outputDirectory: "/private/host-output", resultDigest: "b".repeat(64) })
    expect(() =>
      requireGenerationRecoveryRequest({
        operationId: "operation-one",
        outputDirectory: "/private/host-output",
        requestDigest: "a".repeat(64),
      }),
    ).toThrow()
  })

  test("normalizes terminal and non-terminal snapshots while rejecting unsafe diagnostics", () => {
    expect(
      normalizeGenerationRecoverySnapshot({
        schema: "convax.generation-lro-snapshot/1",
        status: "succeeded",
        taskId: "task_123",
        resultDigest: "b".repeat(64),
      }),
    ).toEqual({
      schema: "convax.generation-lro-snapshot/1",
      status: "succeeded",
      taskId: "task_123",
      resultDigest: "b".repeat(64),
    })
    expect(
      normalizeGenerationRecoverySnapshot({
        error: { code: "provider_unavailable", message: "The generation service is temporarily unavailable" },
        schema: "convax.generation-lro-snapshot/1",
        status: "failed",
      }),
    ).toMatchObject({ status: "failed" })
    expect(() =>
      normalizeGenerationRecoverySnapshot({
        error: { code: "failed", message: "Authorization: Bearer secret" },
        schema: "convax.generation-lro-snapshot/1",
        status: "failed",
      }),
    ).toThrow("safe")
  })

  test("keeps the extension surface fixed and provider-neutral", () => {
    expect(Object.values(generationLroMethods)).toEqual([
      "convax/generation/operations/get",
      "convax/generation/operations/wait",
      "convax/generation/operations/cancel",
      "convax/generation/operations/result",
      "convax/generation/operations/acknowledge",
    ])
  })
})
