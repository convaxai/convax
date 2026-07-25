import { describe, expect, test } from "bun:test"

import {
  generationRecoveryMethods,
  normalizeGenerationRecoveryCapability,
  normalizeGenerationRecoverySnapshot,
  requireGenerationRecoveryRequest,
} from "./generation-recovery-protocol"

describe("Generic generation recovery protocol", () => {
  test("normalizes the exact all-or-nothing capability handshake", () => {
    expect(
      normalizeGenerationRecoveryCapability({
        binding: "account-binding-7c9e",
        mode: "operation-exactly-once",
        schema: "convax.generation-recovery/1",
      }),
    ).toEqual({
      binding: "account-binding-7c9e",
      mode: "operation-exactly-once",
      schema: "convax.generation-recovery/1",
    })
    expect(() =>
      normalizeGenerationRecoveryCapability({
        binding: "account-binding",
        lookup: true,
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
      schema: "convax.generation-recovery-request/1",
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
        schema: "convax.generation-recovery-snapshot/1",
        status: "succeeded",
        taskId: "task_123",
        resultDigest: "b".repeat(64),
      }),
    ).toEqual({
      schema: "convax.generation-recovery-snapshot/1",
      status: "succeeded",
      taskId: "task_123",
      resultDigest: "b".repeat(64),
    })
    expect(
      normalizeGenerationRecoverySnapshot({
        error: { code: "provider_unavailable", message: "The generation service is temporarily unavailable" },
        schema: "convax.generation-recovery-snapshot/1",
        status: "failed",
      }),
    ).toMatchObject({ status: "failed" })
    expect(() =>
      normalizeGenerationRecoverySnapshot({
        error: { code: "failed", message: "Authorization: Bearer secret" },
        schema: "convax.generation-recovery-snapshot/1",
        status: "failed",
      }),
    ).toThrow("safe")
  })

  test("keeps the extension surface fixed and provider-neutral", () => {
    expect(Object.values(generationRecoveryMethods)).toEqual([
      "convax/generation/operation/lookup",
      "convax/generation/task/query",
      "convax/generation/task/await",
      "convax/generation/operation/cancel",
      "convax/generation/task/result",
      "convax/generation/operation/acknowledge",
    ])
  })
})
