# StoryAI 3D Director Desk vendoring

The static application in this directory is built from:

- repository: `https://github.com/jiguang132/storyai-3d-director-desk`
- upstream commit: `8c8bd361790be4d37158a7430365e65546e358fe`
- upstream package version: `0.0.1`
- source license: MIT, Copyright (c) 2026 YZ

This is not the private MiniMax Hub `3d-director-stage` plugin. Convax uses the
open-source project as an independent built-in Plugin and does not copy MiniMax
Hub assets or code.

The Convax build differs from upstream in seven deliberate ways:

1. it uses the existing `convax.plugin-host/1` MessageChannel instead of wildcard
   parent-window messages;
2. portable scene state and the director viewport camera are kept separate inside
   one owning Canvas-node snapshot, with schema-v1 migration, schema-v2 hydration,
   early host connection, bounded snapshots, gesture-end flush (including a final
   snapshot while an intermediate write is in flight), timeout/retry and fail-closed
   schema handling;
3. browser `localStorage` persistence and unsupported host capture messages are
   disabled inside the opaque-origin sandbox;
4. the bundled Sketchfab Standard mannequin is omitted. The MIT-licensed
   procedural mannequin remains available, avoiding redistribution of a model that
   is not itself open source;
5. local model import and image-download controls are hidden until scoped host
   capabilities can support them without relaxing the Plugin CSP or iframe sandbox;
6. the MessageChannel handshake accepts only the parent host and this exact Plugin
   id before treating the transferred port as a scoped capability token.
7. session-only local media and camera captures remain usable, but surface a visible
   portability warning instead of silently pretending their browser URLs persist.

The complete static Plugin package lives under
`packages/desktop/resources/plugins/storyai-3d-director-desk/`. The Desktop catalog
embeds these files as application resources and the normal Plugin manager copies
them into `userData/plugins/<id>/` only when the user installs the built-in Plugin.
The iframe never executes code from a development dependency or Node module.

The generated JavaScript and CSS use stable asset names. Do not hand-edit them.
The checked-in outputs are pinned by these SHA-256 hashes:

- `assets/app.js`: `86be2a0c44a4c975ee5d63033ec8ffb764f9d80a66d7218b6534cb5d9dddfb37`
- `assets/styles.css`: `6cce301d037ab3483cda7a5d1587fcd6258e59e7baee4ed6d8b17fc080ac8620`
- `index.html`: `cca741699d677bb752288d02a61e11228cdcd810787bfb06f6d96e2deab9e646`
- `UPSTREAM.patch`: `9b25fa03c69f346d46a33d82e295a04c22bf8f80146aeda21e08430a103bf287`
- `UPSTREAM.state.patch`: `04732e1e1d711ffddd0ccafc044c8fa4114a3e4808c9cb75cdab3eb621619124`
- `UPSTREAM.view.patch`: `326188b1fd0d45f7cd9b59645a7bdbc5c0f60c0efd0d0b33623b762c055aa49e`

To rebuild, check out the pinned commit and apply `UPSTREAM.patch`,
`UPSTREAM.state.patch`, then `UPSTREAM.view.patch`. Remove `public/models/` so Vite
cannot copy the non-open mannequin, run `npm ci` from the upstream lockfile, and run
`npm run build`. Review the output and update every hash above before replacing the
generated files; toolchain differences can change minified bytes even when behavior
is unchanged.
