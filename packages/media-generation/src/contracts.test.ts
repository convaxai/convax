import { expect, test } from "bun:test"
import type {
  ImageGenerationRequest,
  MediaGenerationModelRef,
  VideoGenerationJob,
  VideoGenerationModel,
  VideoGenerationRequest,
} from "./contracts"

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

  expect(imageRequest.model).toBe("openai/gpt-image-1")
  expect(videoRequest.model).toBe("google/veo-3.1")
  expect(hostScopedRequest.prompt).toBe("A glass bird")
})
