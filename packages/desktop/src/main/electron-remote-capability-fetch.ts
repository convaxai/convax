import type { ClientRequest, ClientRequestConstructorOptions, IncomingMessage, Net } from "electron"

import type { RemoteCapabilityFetch } from "./remote-capability-registry"

export type ElectronNetRequest = Pick<Net, "request">

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException("Remote capability request was cancelled", "AbortError")
}

function requestHeaders(input?: HeadersInit) {
  const output: Record<string, string> = {}
  new Headers(input).forEach((value, key) => {
    output[key] = value
  })
  return output
}

function responseHeaders(input: Record<string, string | string[]>) {
  const output = new Headers()
  for (const [key, values] of Object.entries(input)) {
    for (const value of Array.isArray(values) ? values : [values]) output.append(key, value)
  }
  return output
}

function responseError(message: string) {
  return new Error(`Electron remote capability request ${message}`)
}

/**
 * Adapts Electron's main-process network stack to the narrow fetch contract used by
 * the remote capability Registry. Redirects remain manual so the Registry client
 * can validate every hop before issuing the next request.
 */
export function createElectronRemoteCapabilityFetch(electronNet: ElectronNetRequest): RemoteCapabilityFetch {
  return (input, init = {}) => {
    const signal = init.signal ?? undefined
    if (signal?.aborted) return Promise.reject(abortError(signal))
    if (init.body !== undefined && init.body !== null) {
      return Promise.reject(new TypeError("Electron remote capability requests do not support request bodies"))
    }

    return new Promise<Response>((resolve, reject) => {
      let request: ClientRequest
      let responseMessage: IncomingMessage | undefined
      let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
      let responseFinished = false
      let settled = false

      const removeAbortListener = () => signal?.removeEventListener("abort", onSignalAbort)

      const cleanupResponseListeners = () => {
        if (!responseMessage) return
        responseMessage.removeListener("data", onResponseData)
        responseMessage.removeListener("end", onResponseEnd)
        responseMessage.removeListener("error", onResponseError)
        responseMessage.removeListener("aborted", onResponseAborted)
      }

      const finishStream = (error?: Error) => {
        if (responseFinished) return
        responseFinished = true
        removeAbortListener()
        cleanupResponseListeners()
        if (error) streamController?.error(error)
        else streamController?.close()
      }

      const rejectBeforeResponse = (error: unknown) => {
        if (settled) return
        settled = true
        removeAbortListener()
        reject(error)
      }

      function onResponseData(chunk: Buffer) {
        if (!responseFinished) streamController?.enqueue(Uint8Array.from(chunk))
      }

      function onResponseEnd() {
        finishStream()
      }

      function onResponseError(error: Error) {
        finishStream(error)
      }

      function onResponseAborted() {
        finishStream(signal?.aborted ? abortError(signal) : responseError("response was aborted"))
      }

      function onRequestError(error: Error) {
        if (!settled) rejectBeforeResponse(error)
        else if (streamController && !responseFinished) finishStream(error)
      }

      function onRedirect(
        statusCode: number,
        _method: string,
        redirectUrl: string,
        headers: Record<string, string[]>,
      ) {
        if (settled) return
        try {
          const responseHeaderValues = responseHeaders(headers)
          responseHeaderValues.set("location", redirectUrl)
          const response = new Response(null, { headers: responseHeaderValues, status: statusCode })
          settled = true
          responseFinished = true
          removeAbortListener()
          resolve(response)
        } catch (error) {
          rejectBeforeResponse(error)
        }
        // Deliberately do not call followRedirect(). Electron will cancel this
        // transaction; the Registry client validates Location and starts the next.
      }

      function onResponse(response: IncomingMessage) {
        if (settled) return
        responseMessage = response
        try {
          const hasBody = ![204, 205, 304].includes(response.statusCode)
          const body = hasBody
            ? new ReadableStream<Uint8Array>({
                cancel() {
                  if (responseFinished) return
                  responseFinished = true
                  removeAbortListener()
                  cleanupResponseListeners()
                  request.abort()
                },
                start(controller) {
                  streamController = controller
                  response.on("data", onResponseData)
                  response.once("end", onResponseEnd)
                  response.once("error", onResponseError)
                  response.once("aborted", onResponseAborted)
                },
              })
            : null
          const result = new Response(body, {
            headers: responseHeaders(response.headers),
            status: response.statusCode,
            statusText: response.statusMessage,
          })
          settled = true
          if (!hasBody) {
            responseFinished = true
            removeAbortListener()
          }
          resolve(result)
        } catch (error) {
          cleanupResponseListeners()
          rejectBeforeResponse(error)
          request.abort()
        }
      }

      function onSignalAbort() {
        const error = abortError(signal!)
        if (!settled) rejectBeforeResponse(error)
        else finishStream(error)
        request.abort()
      }

      const options: ClientRequestConstructorOptions = {
        bypassCustomProtocolHandlers: true,
        credentials: "omit",
        headers: requestHeaders(init.headers),
        method: init.method ?? "GET",
        redirect: "manual",
        url: input,
      }

      try {
        request = electronNet.request(options)
        request.on("error", onRequestError)
        // Electron may emit ClientRequest "close" before "response" for a
        // successful request, so response completion is owned by IncomingMessage.
        request.on("redirect", onRedirect)
        request.once("response", onResponse)
        signal?.addEventListener("abort", onSignalAbort, { once: true })
        request.end()
      } catch (error) {
        rejectBeforeResponse(error)
      }
    })
  }
}
