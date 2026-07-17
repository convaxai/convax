import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"

import type { ClientRequest, ClientRequestConstructorOptions, IncomingMessage } from "electron"

import {
  createElectronRemoteCapabilityFetch,
  type ElectronNetRequest,
} from "./electron-remote-capability-fetch"

class FakeIncomingMessage extends EventEmitter {
  headers: Record<string, string | string[]> = {}
  statusCode = 200
  statusMessage = "OK"
}

class FakeClientRequest extends EventEmitter {
  abortCalls = 0
  endCalls = 0
  followRedirectCalls = 0
  onEnd: (() => void) | undefined

  abort() {
    this.abortCalls += 1
  }

  end() {
    this.endCalls += 1
    this.onEnd?.()
    return this
  }

  followRedirect() {
    this.followRedirectCalls += 1
  }
}

function fakeNet(requests: FakeClientRequest[]) {
  const options: ClientRequestConstructorOptions[] = []
  const net = {
    request(input: ClientRequestConstructorOptions) {
      options.push(input)
      const request = requests.shift()
      if (!request) throw new Error("No fake request is available")
      return request as unknown as ClientRequest
    },
  } as ElectronNetRequest
  return { net, options }
}

function emitResponse(request: FakeClientRequest, response: FakeIncomingMessage) {
  request.emit("response", response as unknown as IncomingMessage)
}

describe("createElectronRemoteCapabilityFetch", () => {
  test("uses an anonymous built-in request and streams the response body", async () => {
    const request = new FakeClientRequest()
    const message = new FakeIncomingMessage()
    message.headers = { "content-type": "text/plain", etag: '"registry-1"' }
    request.onEnd = () =>
      queueMicrotask(() => {
        // Electron can emit ClientRequest close before delivering IncomingMessage.
        request.emit("close")
        emitResponse(request, message)
      })
    const { net, options } = fakeNet([request])
    const fetch = createElectronRemoteCapabilityFetch(net)

    const response = await fetch("https://example.test/registry.json", {
      credentials: "include",
      headers: new Headers({ accept: "application/json", "if-none-match": '"cached"' }),
      redirect: "follow",
    })

    expect(options).toEqual([
      {
        bypassCustomProtocolHandlers: true,
        credentials: "omit",
        headers: { accept: "application/json", "if-none-match": '"cached"' },
        method: "GET",
        redirect: "manual",
        url: "https://example.test/registry.json",
      },
    ])
    expect(response.status).toBe(200)
    expect(response.headers.get("etag")).toBe('"registry-1"')

    const reader = response.body!.getReader()
    const firstRead = reader.read()
    message.emit("data", Buffer.from("hello "))
    expect(new TextDecoder().decode((await firstRead).value)).toBe("hello ")
    const secondRead = reader.read()
    message.emit("data", Buffer.from("convax"))
    expect(new TextDecoder().decode((await secondRead).value)).toBe("convax")
    const endRead = reader.read()
    message.emit("end")
    expect(await endRead).toEqual({ done: true, value: undefined })
  })

  test("turns Electron's manual redirect event into a response with Location", async () => {
    const request = new FakeClientRequest()
    request.onEnd = () =>
      queueMicrotask(() => {
        request.emit("redirect", 302, "GET", "https://release-assets.githubusercontent.com/file.zip", {
          "cache-control": ["private"],
        })
        request.emit("error", new Error("Redirect was cancelled"))
        request.emit("close")
      })
    const { net } = fakeNet([request])

    const response = await createElectronRemoteCapabilityFetch(net)("https://github.com/release.zip")

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("https://release-assets.githubusercontent.com/file.zip")
    expect(request.followRedirectCalls).toBe(0)
  })

  test("aborts an in-flight Electron request when its signal is cancelled", async () => {
    const request = new FakeClientRequest()
    const { net } = fakeNet([request])
    const controller = new AbortController()
    const pending = createElectronRemoteCapabilityFetch(net)("https://example.test/registry.json", {
      signal: controller.signal,
    })

    controller.abort()

    await expect(pending).rejects.toHaveProperty("name", "AbortError")
    expect(request.abortCalls).toBe(1)
  })

  test("propagates request and response stream errors", async () => {
    const failedRequest = new FakeClientRequest()
    failedRequest.onEnd = () => queueMicrotask(() => failedRequest.emit("error", new Error("network unavailable")))
    const streamingRequest = new FakeClientRequest()
    const message = new FakeIncomingMessage()
    streamingRequest.onEnd = () => queueMicrotask(() => emitResponse(streamingRequest, message))
    const { net } = fakeNet([failedRequest, streamingRequest])
    const fetch = createElectronRemoteCapabilityFetch(net)

    await expect(fetch("https://example.test/registry.json")).rejects.toThrow("network unavailable")
    const response = await fetch("https://example.test/package.zip")
    const body = response.text()
    message.emit("error", new Error("connection reset"))
    await expect(body).rejects.toThrow("connection reset")
  })
})
