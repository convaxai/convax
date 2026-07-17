export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonObject = Readonly<Record<string, JsonValue>>
export type ProviderOptions = Readonly<Record<string, JsonObject>>

/** Execution-only controls kept outside the serializable provider request. */
export interface ProviderCallOptions {
  readonly signal?: AbortSignal
}

/** Persistable selection of one outer adapter and one provider-owned model. */
export interface MediaGenerationModelRef {
  /** Registered outer adapter id, for example `openrouter`. */
  readonly provider_id: string
  /** Provider-owned model slug, for example `bytedance-seed/seedream-4.5`. */
  readonly model: string
}

export interface ModelList<TModel> {
  readonly data: readonly TModel[]
}

export type CapabilityDescriptor =
  | { readonly type: "enum"; readonly values: readonly JsonValue[] }
  | { readonly type: "range"; readonly min: number; readonly max: number }
  | { readonly type: "boolean" }

export type ModelCapabilities = Readonly<Record<string, CapabilityDescriptor>>
export type MediaModality = "text" | "image" | "file" | "audio" | "video" | (string & {})

export interface ModelArchitecture {
  readonly input_modalities: readonly MediaModality[]
  readonly output_modalities: readonly MediaModality[]
}

export interface GenerationUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly total_tokens?: number
  /** Cost in USD when known. `null` means the provider explicitly reported no value. */
  readonly cost?: number | null
  readonly is_byok?: boolean
  readonly details?: JsonObject
}

export interface ImageUrlReference {
  readonly type: "image_url"
  readonly image_url: { readonly url: string }
}

export interface AudioUrlReference {
  readonly type: "audio_url"
  readonly audio_url: { readonly url: string }
}

export interface VideoUrlReference {
  readonly type: "video_url"
  readonly video_url: { readonly url: string }
}

export type MediaReference = ImageUrlReference | AudioUrlReference | VideoUrlReference

export type ProviderSort = "price" | "throughput" | "latency" | "exacto" | (string & {})

export interface ProviderSortConfig {
  readonly by?: ProviderSort | null
  readonly partition?: "model" | "none" | (string & {}) | null
}

/** Endpoint routing inside an image provider; this is not the outer adapter selector. */
export interface ImageProviderPreferences {
  readonly only?: readonly string[]
  readonly order?: readonly string[]
  readonly ignore?: readonly string[]
  readonly sort?: ProviderSort | ProviderSortConfig | null
  readonly allow_fallbacks?: boolean | null
  readonly options?: ProviderOptions
}

/** OpenRouter currently guarantees provider-specific options for video requests. */
export interface VideoProviderPreferences {
  readonly options?: ProviderOptions
}

export interface ImageGenerationModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly created?: number
  readonly architecture: ModelArchitecture
  /** Union of the capabilities advertised by all endpoints for this model. */
  readonly supported_parameters: ModelCapabilities
  readonly supports_streaming: boolean
  readonly endpoints?: string
}

export interface ImagePricingEntry {
  readonly billable: string
  readonly unit: string
  readonly cost_usd: number
  readonly variant?: string
}

export interface ImageModelEndpoint {
  readonly provider_name: string
  readonly provider_slug: string
  readonly provider_tag: string | null
  readonly supported_parameters: ModelCapabilities
  readonly allowed_passthrough_parameters: readonly string[]
  readonly supports_streaming: boolean
  readonly pricing: readonly ImagePricingEntry[]
}

export interface ImageModelEndpoints {
  readonly id: string
  readonly endpoints: readonly ImageModelEndpoint[]
}

export interface ImageGenerationRequest {
  readonly model: string
  readonly prompt: string
  readonly n?: number
  readonly resolution?: string
  readonly aspect_ratio?: string
  readonly size?: string
  readonly quality?: "auto" | "low" | "medium" | "high"
  readonly output_format?: "png" | "jpeg" | "webp" | "svg"
  readonly background?: "auto" | "transparent" | "opaque"
  readonly output_compression?: number
  readonly seed?: number
  readonly input_references?: readonly ImageUrlReference[]
  readonly provider?: ImageProviderPreferences
}

export type BufferedImageGenerationRequest = ImageGenerationRequest & { readonly stream?: false }
export type StreamingImageGenerationRequest = ImageGenerationRequest & { readonly stream: true }

export interface GeneratedImage {
  readonly b64_json: string
  readonly media_type?: string
}

export interface ImageGenerationResponse {
  readonly created: number
  readonly data: readonly GeneratedImage[]
  readonly usage?: GenerationUsage
}

export interface ImageGenerationPartialImageEvent {
  readonly type: "image_generation.partial_image"
  readonly partial_image_index: number
  readonly b64_json: string
}

export interface ImageGenerationTextChunkEvent {
  readonly type: "image_generation.text_chunk"
  readonly phase: "content" | "reasoning" | "draft" | (string & {})
  readonly text: string
}

export interface ImageGenerationCompletedEvent {
  readonly type: "image_generation.completed"
  readonly b64_json: string
  readonly media_type?: string
  readonly created: number
  readonly usage?: GenerationUsage
}

export interface ImageGenerationStreamErrorEvent {
  readonly type: "error"
  readonly error: {
    readonly message: string
    readonly code?: string | null
    readonly type?: string | null
    readonly param?: string | null
  }
}

export type ImageGenerationEvent =
  | ImageGenerationPartialImageEvent
  | ImageGenerationTextChunkEvent
  | ImageGenerationCompletedEvent
  | ImageGenerationStreamErrorEvent

/** Buffered and streamed image lifecycles stay distinct at the type boundary. */
export interface ImageGenerationProvider {
  listModels(options?: ProviderCallOptions): Promise<ModelList<ImageGenerationModel>>
  listModelEndpoints?(model: string, options?: ProviderCallOptions): Promise<ImageModelEndpoints>
  generate(request: BufferedImageGenerationRequest, options?: ProviderCallOptions): Promise<ImageGenerationResponse>
  stream?(request: StreamingImageGenerationRequest, options?: ProviderCallOptions): AsyncIterable<ImageGenerationEvent>
}

export type VideoFrameType = "first_frame" | "last_frame"

export interface VideoFrameImage extends ImageUrlReference {
  readonly frame_type: VideoFrameType
}

export interface VideoGenerationModel {
  readonly id: string
  readonly canonical_slug: string
  readonly name: string
  readonly description?: string | null
  readonly hugging_face_id?: string | null
  readonly created: number
  readonly supported_resolutions: readonly string[] | null
  readonly supported_aspect_ratios: readonly string[] | null
  readonly supported_sizes: readonly string[] | null
  readonly supported_durations: readonly number[] | null
  readonly supported_frame_images: readonly VideoFrameType[] | null
  readonly generate_audio: boolean | null
  readonly seed: boolean | null
  readonly pricing_skus?: Readonly<Record<string, string>> | null
  readonly allowed_passthrough_parameters: readonly string[]
}

export interface VideoGenerationRequest {
  readonly model: string
  readonly prompt: string
  readonly duration?: number
  readonly resolution?: string
  readonly aspect_ratio?: string
  readonly size?: string
  readonly frame_images?: readonly VideoFrameImage[]
  readonly input_references?: readonly MediaReference[]
  readonly generate_audio?: boolean
  readonly seed?: number
  readonly callback_url?: string
  readonly provider?: VideoProviderPreferences
}

export type KnownVideoGenerationStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired"

export type VideoGenerationStatus = KnownVideoGenerationStatus | (string & {})

export interface VideoGenerationJob {
  /** Provider-owned poll handle. This is not the later `generation_id`. */
  readonly id: string
  readonly status: VideoGenerationStatus
  readonly model?: string | null
  readonly generation_id?: string | null
  readonly polling_url?: string
  readonly unsigned_urls?: readonly string[]
  readonly usage?: GenerationUsage
  readonly error?: string
}

export interface VideoGenerationContent {
  readonly body: ReadableStream<Uint8Array>
  readonly media_type: string
  readonly content_length?: number
}

/** Video generation stays an explicit asynchronous job and content lifecycle. */
export interface VideoGenerationProvider {
  listModels(options?: ProviderCallOptions): Promise<ModelList<VideoGenerationModel>>
  create(request: VideoGenerationRequest, options?: ProviderCallOptions): Promise<VideoGenerationJob>
  retrieve(jobId: string, options?: ProviderCallOptions): Promise<VideoGenerationJob>
  content(jobId: string, index?: number, options?: ProviderCallOptions): Promise<VideoGenerationContent>
}

/**
 * Contract only. Implementations, credentials, registries, fallback, persistence,
 * and Canvas adaptation stay at explicit host edges.
 */
export interface MediaGenerationProvider {
  /** Stable outer-adapter id, distinct from request-side endpoint routing. */
  readonly id: string
  readonly name: string
  readonly images?: ImageGenerationProvider
  readonly videos?: VideoGenerationProvider
}
