import { expect, test } from "bun:test"
import type {
  AudioUrlReference,
  ImageGenerationProvider,
  ImageGenerationRequest,
  MediaGenerationModelRef,
  ProviderCallOptions,
  VideoFrameImage,
  VideoGenerationJob,
  VideoGenerationModel,
  VideoGenerationRequest,
} from "./contracts"

function assertImageProviderMethodTypes(provider: ImageGenerationProvider) {
  const base = { model: "openai/gpt-image-1", prompt: "A glass bird" } as const
  provider.generate(base)
  provider.generate({ ...base, stream: false })
  // @ts-expect-error Buffered generation cannot accept a streaming request.
  provider.generate({ ...base, stream: true })
  provider.stream?.({ ...base, stream: true })
  // @ts-expect-error Streaming generation requires stream: true.
  provider.stream?.(base)
  // @ts-expect-error Streaming generation cannot opt out of streaming.
  provider.stream?.({ ...base, stream: false })
}

void assertImageProviderMethodTypes

test("image requests keep one model and namespaced endpoint routing", () => {
  const request = {
    model: "bytedance-seed/seedream-4.5",
    prompt: "A red panda astronaut",
    aspect_ratio: "16:9",
    input_references: [{ type: "image_url", image_url: { url: "https://example.com/reference.png" } }],
    provider: {
      only: ["bytedance"],
      allow_fallbacks: false,
      options: {
        bytedance: { watermark: false },
      },
    },
  } satisfies ImageGenerationRequest

  expect(request.model).toBe("bytedance-seed/seedream-4.5")
  expect(request.provider.options.bytedance.watermark).toBe(false)
})

test("image wire requests preserve streaming, nullable routing, and open provider capabilities", () => {
  const request = {
    model: "quiver/vectorize",
    prompt: "A scalable line illustration",
    stream: true,
    quality: "provider-ultra",
    output_format: "svg",
    background: "provider-matte",
    provider: { ignore: null, only: null, order: null },
  } satisfies ImageGenerationRequest
  const futureFrame = {
    type: "image_url",
    image_url: { url: "https://example.com/key-frame.png" },
    frame_type: "key_frame",
  } satisfies VideoFrameImage
  const options = { signal: new AbortController().signal } satisfies ProviderCallOptions

  expect(request.stream).toBeTrue()
  expect(request.output_format).toBe("svg")
  expect(futureFrame.frame_type).toBe("key_frame")
  expect(options.signal.aborted).toBeFalse()
})

test("video requests and jobs preserve the asynchronous OpenRouter lifecycle", () => {
  const request = {
    model: "google/veo-3.1",
    prompt: "A mountain landscape at sunset",
    duration: 8,
    frame_images: [
      {
        type: "image_url",
        image_url: { url: "https://example.com/first-frame.png" },
        frame_type: "first_frame",
      },
    ],
    provider: {
      options: {
        "google-vertex": { parameters: { personGeneration: "allow" } },
      },
    },
  } satisfies VideoGenerationRequest
  const job = {
    id: "job-1",
    generation_id: "generation-1",
    status: "in_progress",
  } satisfies VideoGenerationJob

  expect(request.model).toBe("google/veo-3.1")
  expect(job.id).not.toBe(job.generation_id)
  expect(job.status).toBe("in_progress")
})

test("video model discovery preserves explicitly unavailable capabilities", () => {
  const model = {
    id: "google/veo-3.1",
    canonical_slug: "google/veo-3.1",
    name: "Veo 3.1",
    created: 1_752_883_200,
    supported_resolutions: ["720p", "1080p"],
    supported_aspect_ratios: ["16:9", "9:16"],
    supported_sizes: null,
    supported_durations: [4, 6, 8],
    supported_frame_images: null,
    generate_audio: true,
    seed: null,
    pricing_skus: null,
    allowed_passthrough_parameters: [],
  } satisfies VideoGenerationModel

  expect(model.supported_frame_images).toBeNull()
  expect(model.seed).toBeNull()
})

test("outer provider selection stays separate from provider-owned model slugs", () => {
  const reference = {
    provider_id: "openrouter",
    model: "openai/gpt-image-1",
  } satisfies MediaGenerationModelRef

  expect(reference).toEqual({
    provider_id: "openrouter",
    model: "openai/gpt-image-1",
  })
})

test("wire requests reject fallback lists and host-owned scope", () => {
  const imageRequest: ImageGenerationRequest = {
    model: "openai/gpt-image-1",
    prompt: "A glass bird",
    // @ts-expect-error Dedicated media requests select exactly one model.
    models: ["openai/gpt-image-1", "google/gemini-2.5-flash-image"],
  }
  const videoRequest: VideoGenerationRequest = {
    model: "google/veo-3.1",
    prompt: "A glass bird taking flight",
    // @ts-expect-error The outer adapter id belongs in MediaGenerationModelRef.
    provider_id: "openrouter",
  }
  const hostScopedRequest: ImageGenerationRequest = {
    model: "openai/gpt-image-1",
    prompt: "A glass bird",
    // @ts-expect-error Project paths are host state, not provider wire fields.
    project_path: "/private/project",
  }
  const executionScopedRequest: ImageGenerationRequest = {
    model: "openai/gpt-image-1",
    prompt: "A glass bird",
    // @ts-expect-error Cancellation is an execution option, not a serializable wire field.
    signal: new AbortController().signal,
  }
  const audioReference: AudioUrlReference = {
    type: "audio_url",
    audio_url: { url: "https://example.com/guide.mp3" },
  }
  const invalidFrameRequest: VideoGenerationRequest = {
    model: "google/veo-3.1",
    prompt: "A glass bird taking flight",
    // @ts-expect-error Frame images accept image references only.
    frame_images: [audioReference],
  }
  const invalidProviderRequest: VideoGenerationRequest = {
    model: "google/veo-3.1",
    prompt: "A glass bird taking flight",
    provider: {
      // @ts-expect-error Provider-specific values must stay below options.
      "google-vertex": { watermark: false },
    },
  }

  expect(imageRequest.model).toBe("openai/gpt-image-1")
  expect(videoRequest.model).toBe("google/veo-3.1")
  expect(hostScopedRequest.prompt).toBe("A glass bird")
  expect(executionScopedRequest.prompt).toBe("A glass bird")
  expect(invalidFrameRequest.prompt).toBe("A glass bird taking flight")
  expect(invalidProviderRequest.prompt).toBe("A glass bird taking flight")
})
