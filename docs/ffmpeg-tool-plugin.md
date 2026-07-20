# FFmpeg Tool Plugin

This document defines the product and security contract for adding local FFmpeg
capabilities to Convax without introducing an FFmpeg-specific package, IPC surface,
or Canvas mutation path.

## Product scope

The `ffmpeg-tools` package is a headless `convax.plugin/2` Tool Plugin distributed
from the public `convax-plugins` Registry. Its executable companion exposes FFmpeg
through the existing generation tool boundary.

The first release provides:

- Agent access to FFmpeg codec, filter, mapping, metadata, timing, and container
  arguments through an argv array encoded in `arguments_json`;
- image, video, and audio output tools so the existing generation contract retains
  a stable output modality;
- host-owned video selection actions for extracting a frame, trimming a clip, and
  cropping a clip;
- normal managed Canvas resources and nodes for every accepted output.

Opening a Project never discovers or runs Project-local executables. The current
internal distribution provisions this Plugin once from the official Registry on an
eligible first startup. It still verifies and authorizes only the Registry-pinned
companion bytes through the normal Tool Plugin transaction; it does not introduce a
second executable trust path.

Desktop records independent durable receipts for the Plugin and its embedded
companion Skill. A failed remote attempt is diagnosed and retried on a later startup
without preventing Convax from opening. Once either capability has been installed,
removing it is respected and startup does not restore it. Before public open-source
distribution, this temporary silent default should return to a prominent one-click
Install action.

## Ownership and execution flow

```text
Agent canvas_generate or Desktop video selection action
  -> CanvasGenerateService
  -> generation IPC
  -> GenerationCanvasService
  -> managed Canvas references staged in a private operation directory
  -> GenerationPluginRuntime
  -> verified convax-ffmpeg-mcp launch snapshot
  -> embedded FFmpeg child process (shell disabled)
  -> validated artifacts in the host-owned output directory
  -> CanvasResourceBusinessService
  -> managed .convax/assets files, normal nodes, and source edges
```

`@convax/desktop` owns the toolbar composition because a Plugin Canvas toolbar
contribution applies only to the Plugin's own sandboxed iframe renderer. It must not
replace the built-in video renderer merely to add actions. All media admission,
placement, persistence, rollback, revision guards, and node creation remain in the
existing Canvas and Project services.

## Tool contract

The Plugin contributes three tools:

| Tool                     | Output | Typical use                                 |
| ------------------------ | ------ | ------------------------------------------- |
| `ffmpeg-tools/run.image` | image  | frame extraction, thumbnails, image filters |
| `ffmpeg-tools/run.video` | video  | trim, crop, transcode, mux, filter graphs   |
| `ffmpeg-tools/run.audio` | audio  | extraction, trim, resample, filtering       |

Each MCP input schema extends `convax.generation-call/1` with:

- `arguments_json`: a required JSON-encoded array of argument tokens;
- `output_name`: a safe basename whose extension matches the declared tool output.

Arguments are passed directly to FFmpeg in the supplied order. They are never
parsed as a shell command. The companion prepends only non-interactive execution
guards such as `-nostdin`, `-hide_banner`, and `-y`.

The following exact placeholders provide all file authority:

- `{{input:0}}`, `{{input:1}}`, and so on resolve to staged managed Canvas inputs;
- `{{output}}` resolves to one host-owned path below `output_directory`.

The reviewed build's FFmpeg option, codec, filter, stream mapping, metadata, and
container parameters are not reduced to an operation allowlist. “All parameters”
does not mean arbitrary filesystem or network authority. Literal absolute paths,
URLs, extra output paths, path-opening options, and path-opening filters are
rejected. Adding those capabilities would require a separate dangerous permission
and an OS-enforced filesystem/network sandbox.

The first version accepts one admitted output per invocation. Multiple invocations
can produce multiple nodes. A future multi-output contract must let the host allocate
every output path before execution; it must not accept caller-selected paths.

## Toolbar presets

The Desktop registers three `CanvasSelectionAction` entries only when the Plugin is
installed and one managed video node is selected without an edge selection.

- Extract frame: accepts a non-negative timestamp and returns PNG through
  `ffmpeg-tools/run.image`.
- Trim: accepts a non-negative start and positive duration, then returns a fast-start
  MP4 through `ffmpeg-tools/run.video`.
- Crop: accepts non-negative even x/y coordinates and positive even dimensions, then
  returns a fast-start MP4 through `ffmpeg-tools/run.video`.

The dialog owns only presentation and preset construction. Confirmation calls the
same `CanvasGenerateService` used by Agent generation. A stale selection closes an
unsubmitted dialog; after submission the operation has its own explicit cancel
signal while the existing Project, Canvas, revision, and source-reference guards
remain authoritative. Success is reported only after the output has been admitted
and committed as a new Canvas node.

## Companion packaging

The Registry currently installs one raw executable per Plugin target. Consequently,
`convax-ffmpeg-mcp` must be one self-contained native executable below the Registry's
128 MiB companion limit. It may contain FFmpeg bytes in a Mach-O section and materialize
them into a private per-process temporary directory outside the artifact directory, but
it must verify the embedded digest, launch without a shell, inherit the host-owned process
group, and remove the temporary executable on exit.

The companion must never resolve FFmpeg from `PATH`, load unverified sibling
libraries, or download executable bytes at runtime. Those bytes would not be covered
by the install authorization receipt or launch snapshot.

Development and packaged Convax builds use the same managed companion resolver under
their respective Electron `userData` directories. The Plugin ZIP does not contain
the companion. A real immutable Registry Release must exist before the capability
can be enabled in either environment.

The first executable target is macOS 13 or newer on arm64. It is built from the pinned
official FFmpeg 8.1.2 source release with autodetection, network protocols, devices,
manifest demuxers that can open undeclared files, and multi-file streaming muxers disabled;
only Apple system frameworks plus the system zlib are enabled. The remaining built-in
codecs, single-file muxers, and filters stay available under that reviewed configuration.
Video presets use VideoToolbox H.264 with software fallback, and audio uses
FFmpeg's native AAC encoder. Linux, macOS x64, and Windows targets require their
own native release jobs and smoke tests; Windows execution additionally remains
disabled until Desktop can own the full process tree with a Job Object.

## Distribution and licensing

Separating FFmpeg into an open-source Plugin helps preserve a clear process boundary,
but it does not remove FFmpeg distribution obligations. Release builds must never
use `--enable-nonfree`.

The initial release uses FFmpeg's default LGPL configuration and does not enable
external codec libraries. Its source tarball URL, byte size, SHA-256, detached
signature, signing fingerprint, configure flags, and native dependencies are pinned
and checked by the release pipeline and companion build. Every target Release must
include or accompany:

- exact FFmpeg and dependency sources, patches, and build scripts;
- license texts, build configuration, checksums, and build metadata;
- a software bill of materials and provenance or attestation;
- smoke-test evidence for version, license, architecture, dependencies, frame
  extraction, trim, crop, and cancellation.

The Registry pins the final URL, byte size, and SHA-256 for every target. Floating
`latest` assets are not acceptable.

## Required verification

The companion test suite covers request validation, placeholder substitution,
literal path and URL rejection, output confinement, no-shell process execution,
cancellation, bounded diagnostics, and result envelopes. Release smoke tests execute
the embedded FFmpeg on every native target.

Desktop tests cover Plugin-aware action visibility, preset construction, form
validation, stale-scope recovery policy, and the generation request routed through
`CanvasGenerateService`. Existing generation service tests remain the owner of
managed-input staging, output admission, rollback, revision, and Canvas commit
behavior.
