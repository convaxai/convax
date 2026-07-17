import type { ProviderCallOptions, VideoGenerationContent } from "@convax/media-generation"

const options: ProviderCallOptions = {
  signal: {
    aborted: false,
    addEventListener() {},
    removeEventListener() {},
  },
}

async function consume(content: VideoGenerationContent) {
  for await (const chunk of content.body) {
    const bytes: Uint8Array = chunk
    void bytes
  }
}

void consume
void options
