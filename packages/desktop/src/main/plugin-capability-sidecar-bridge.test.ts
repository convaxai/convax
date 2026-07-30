import { describe, expect, test } from "bun:test"

import { PluginCapabilityBrokerError } from "./plugin-capability-broker"
import {
  createPluginCapabilityNestedMcpHandler,
  pluginCapabilityInvocationAuthoritySchema,
  pluginCapabilityNestedFailureSchema,
  pluginCapabilityNestedInvokeMcpMethod,
} from "./plugin-capability-sidecar-bridge"
import { StdioMcpServerRequestError } from "./stdio-mcp-client"

describe("Plugin capability sidecar bridge errors", () => {
  test("projects provider failure into bounded structured data without leaking diagnostics", async () => {
    const authorityToken = "A".repeat(43)
    const operationId = "a".repeat(64)
    const handler = createPluginCapabilityNestedMcpHandler(
      new Map([
        [
          authorityToken,
          {
            async invoke() {
              throw new PluginCapabilityBrokerError(
                "provider-failed",
                "cookie=secret-value /private/provider/path",
              )
            },
            operationId,
          },
        ],
      ]),
    )

    try {
      await handler.handle(
        {
          method: pluginCapabilityNestedInvokeMcpMethod,
          params: {
            _meta: {
              convaxPluginCapability: {
                authorityToken,
                operationId,
                schema: pluginCapabilityInvocationAuthoritySchema,
              },
            },
            capabilityId: "media.child",
            input: {},
            parentOperationId: operationId,
            requestId: "nested-failure",
          },
        },
        {
          sendNotification() {},
          signal: new AbortController().signal,
        },
      )
      throw new Error("Expected nested invocation to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(StdioMcpServerRequestError)
      expect(error).toMatchObject({
        code: -32_010,
        data: {
          failure: {
            code: "execution-failed",
            kind: "capability",
            message: "Plugin capability provider execution failed",
            recoverable: false,
          },
          schema: pluginCapabilityNestedFailureSchema,
        },
        message: "Plugin capability call failed",
      })
      expect(JSON.stringify((error as StdioMcpServerRequestError).data)).not.toContain("secret-value")
      expect(JSON.stringify((error as StdioMcpServerRequestError).data)).not.toContain("/private/provider/path")
    }
  })
})
