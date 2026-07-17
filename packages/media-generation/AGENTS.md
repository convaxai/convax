# Media Generation Package Contract

This package owns provider-neutral AI image and video generation contracts.

## Invariants

- Keep requests OpenRouter-shaped: one open-ended `model` slug per request,
  snake_case wire fields, capability discovery, and namespaced provider options.
- `MediaGenerationProvider.id` selects the outer adapter, such as OpenRouter. The
  request `provider` field routes endpoints inside that adapter; never conflate them.
- Image generation is buffered or streamed. Video generation is an asynchronous
  create/retrieve/content job flow. Do not invent one ambiguous shared lifecycle.
- `AbortSignal` cancels the local request, stream, or poll only. It does not imply
  that an accepted upstream video job was cancelled.
- Keep model ids and capability values open-ended. Discovery, not a hard-coded
  model enum, is the source of supported models and parameters.
- Provider-specific options are JSON values nested below a provider slug. Do not
  add top-level escape-hatch parameters or silently choose fallback models.

## Does not own

- Provider implementations, HTTP clients, API keys, user preferences, Electron,
  IPC, filesystem/network policy, retries, or concrete provider configuration.
- Provider registries, model-selection/fallback orchestration, Canvas nodes, Project
  paths, `.convax` persistence, asset import, Workbench state, Agent sessions, or
  OpenCode model selection.

Provider outputs stay host-neutral. Desktop may later compose a provider with the
existing Canvas generation/resource services, but Canvas and Agent Runtime must not
depend on this package.

Run `bun typecheck && bun test`; run root `bun run pack:check` for export or package
boundary changes.
