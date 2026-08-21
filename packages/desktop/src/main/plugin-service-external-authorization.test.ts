import { describe, expect, mock, test } from "bun:test"

import {
  DefaultPluginServiceExternalAuthorizationBroker,
  parsePluginServiceExternalAuthorizationRequest,
  pluginServiceExternalAuthorizationCompletionSchema,
  pluginServiceExternalAuthorizationRequestSchema,
} from "./plugin-service-external-authorization"

describe("Plugin service external authorization", () => {
  test("accepts canonical HTTPS and local loopback authorization URLs", () => {
    expect(
      parsePluginServiceExternalAuthorizationRequest({
        authorization_id: "request_0123456789abcdef",
        authorization_url:
          "https://nexus.microvoid.io/workspace/convax/auth/sign-in?state=state&code_challenge=challenge",
        schema: pluginServiceExternalAuthorizationRequestSchema,
      }),
    ).toEqual({
      authorizationId: "request_0123456789abcdef",
      authorizationUrl: "https://nexus.microvoid.io/workspace/convax/auth/sign-in?state=state&code_challenge=challenge",
      schema: pluginServiceExternalAuthorizationRequestSchema,
      timeoutSeconds: 300,
    })
    expect(
      parsePluginServiceExternalAuthorizationRequest({
        authorization_id: "request_0123456789abcdef",
        authorization_url: "http://127.0.0.1:3000/workspace/convax/auth/sign-in?state=state&code_challenge=challenge",
        schema: pluginServiceExternalAuthorizationRequestSchema,
        timeout_seconds: 600,
      }).timeoutSeconds,
    ).toBe(600)
  })

  test("rejects insecure remote, credential-bearing and fragmented URLs", () => {
    for (const authorization_url of [
      "http://nexus.example/workspace/convax/auth/sign-in",
      "https://user:password@nexus.example/workspace/convax/auth/sign-in",
      "https://nexus.example/workspace/convax/auth/sign-in#token",
    ]) {
      expect(() =>
        parsePluginServiceExternalAuthorizationRequest({
          authorization_id: "request_0123456789abcdef",
          authorization_url,
          schema: pluginServiceExternalAuthorizationRequestSchema,
        }),
      ).toThrow()
    }
  })

  test("opens only the parsed URL and returns a secret-free completion", async () => {
    const openExternal = mock(async () => undefined)
    const broker = new DefaultPluginServiceExternalAuthorizationBroker(openExternal)
    const request = parsePluginServiceExternalAuthorizationRequest({
      authorization_id: "request_0123456789abcdef",
      authorization_url: "https://nexus.example/workspace/convax/auth/sign-in?state=opaque-state",
      schema: pluginServiceExternalAuthorizationRequestSchema,
    })
    expect(await broker.authorize({ pluginId: "nexus-service", serviceId: "nexus-service" }, request, {})).toEqual({
      authorization_id: "request_0123456789abcdef",
      schema: pluginServiceExternalAuthorizationCompletionSchema,
    })
    expect(openExternal).toHaveBeenCalledWith(request.authorizationUrl)
  })
})
