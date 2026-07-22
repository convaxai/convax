# FFmpeg Tool Plugin

This document defines the product and security contract for adding local FFmpeg
capabilities to Convax without introducing an FFmpeg-specific package, IPC surface,
or Canvas mutation path.

## Product scope

The `ffmpeg-tools` package is a headless `convax.plugin/4` Tool Plugin distributed
from the public `convax-plugins` Registry. Its executable companion exposes FFmpeg
through the shared executable-tool boundary. The manifest classifies every FFmpeg
tool as an operation, so none appears as a generation model.

The first release provides:

- Agent access to FFmpeg codec, filter, mapping, metadata, timing, and container
  arguments through an argv array encoded in `arguments_json`;
- image, video, and audio output tools so the existing generation contract retains
  a stable output modality;
- host-owned video selection actions for extracting a frame, trimming a clip,
  separating audio and video, and cropping a clip;
- normal managed Canvas resources and nodes for every accepted output.

Opening a Project never discovers or runs Project-local executables. Packaging
downloads the current Plugin ZIP and exact host companion from the official Registry,
validates them with the production Registry client, and embeds the original bytes as
a target-specific first-install seed. An eligible first startup revalidates that seed
and provisions it through the normal remote Tool Plugin transaction. It still
authorizes only Registry-pinned companion bytes and does not introduce a second
executable trust path or built-in Plugin identity.

Its `ffmpeg-canvas` Skill is an owned `contributes.skills` directory, not a second
standalone installation. Desktop publishes the Plugin package, executable
authorization, materialized Skill, and ownership binding as one coordinated
transaction. A synchronous failure before the owned-Skill forward decision restores
the previous Plugin, authorization, Skill bytes, and binding. Once that decision is
durable, cleanup keeps the updated capability current and completes during startup
recovery. Uninstall removes both. A failed seed attempt is diagnosed without recording
a receipt; the post-window network phase can recover it. Later startups fetch Registry
metadata in the background and download only a newer immutable release, so update
latency never holds the first window. Once the Plugin has been removed, its
one-time default receipt prevents startup from restoring it. Before public
open-source distribution, this temporary silent default should return to a prominent
one-click Install action.

## Ownership and execution flow

```text
Agent manifest operation tools ---------------------------------+
                                                                 |
Manifest-declared video action -> CanvasGenerateService          |
  -> generation IPC ---------------------------------------------+
                                                                 |
                                                                 v
                                                    GenerationCanvasService
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

The Plugin contributes three unrestricted, Agent-facing argv tools and five
host-rendered high-level operation tools:

| Tool                               | Output | Surface / typical use                         |
| ---------------------------------- | ------ | --------------------------------------------- |
| `ffmpeg-tools/run.image`           | image  | Agent argv: frames, thumbnails, image filters |
| `ffmpeg-tools/run.video`           | video  | Agent argv: transcode, mux, filter graphs     |
| `ffmpeg-tools/run.audio`           | audio  | Agent argv: trim, resample, filtering         |
| `ffmpeg-tools/frame.extract`       | image  | time-point selection action                   |
| `ffmpeg-tools/video.trim`          | video  | timeline range selection action               |
| `ffmpeg-tools/video.crop`          | video  | visual crop-region selection action           |
| `ffmpeg-tools/video.without-audio` | video  | first audio/video separation step             |
| `ffmpeg-tools/audio.extract`       | audio  | second audio/video separation step            |

The three `run.*` MCP input schemas extend `convax.generation-call/1` with:

- `arguments_json`: a required JSON-encoded array of argument tokens;
- `output_name`: a safe basename whose extension matches the declared tool output.

Arguments are passed directly to FFmpeg in the supplied order. They are never
parsed as a shell command. The companion prepends only non-interactive execution
guards such as `-nostdin`, `-hide_banner`, and `-y`.

The five high-level tools accept only their declared numeric fields. The sidecar,
not Desktop, constructs their FFmpeg argv and output basename. This keeps codec and
command knowledge inside the Plugin while allowing the host to render reusable
time-point, time-range, crop-region, and confirmation editors.

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

The manifest declares four host-rendered selection actions. Desktop discovers them
from any installed v3 or v4 Plugin and shows them when one managed video node is selected
without an edge selection; it does not identify `ffmpeg-tools` in business code.

- Extract frame: accepts a non-negative timestamp and calls the declared
  `frame.extract` operation.
- Trim: presents a real-duration thumbnail timeline with two accessible range
  handles, then calls the declared `video.trim` operation.
- Separate audio and video: creates one silent MP4 and one independent M4A. Both
  output cards connect to the source video and to each other, while each invocation
  remains guarded to exactly one admitted output.
- Crop: autoplays the selected video under a draggable eight-handle crop frame,
  normalizes the result to even YUV 4:2:0 pixel values, and returns a fast-start MP4
  through the declared `video.crop` operation.

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
the companion. The packaged seed retains the two Registry artifacts separately, and
the app never executes its resource copy in place: normal publication copies the
companion into `userData/plugin-companions`, writes the exact authorization receipt,
and atomically publishes the Plugin and owned Skill. A real immutable Registry
Release must exist before either development installation or packaging can enable
the capability.

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

Desktop tests cover packaged-seed staging, tamper/path/target rejection, offline
fresh-profile installation and managed companion authorization. They also cover
manifest-driven action visibility, request construction, form validation,
stale-scope recovery policy, and the generation request routed through
`CanvasGenerateService`. Existing generation service tests remain the owner of
managed-input staging, output admission, rollback, revision, and Canvas commit
behavior.

## Direct Agent surface

FFmpeg is a transform Plugin rather than a generative model. Its v4 manifest keeps
`generation.models` empty and maps the three `run.*` operations to Agent ids.
Desktop derives stable names such as `plugin_ffmpeg_tools_run_video` through the
same generic operation adapter used by every Plugin. `canvas_generate` and the
generation-model picker select only manifest-declared models; neither contains an
FFmpeg exclusion or Plugin-id branch.

The generic operation input contains ordered Canvas references, bounded scalar
`toolInput` fields (including the low-level JSON argv and output basename), optional
relation nodes, and an optional placement anchor.
Active Project, Canvas, revision, actor, and operation identity are derived by the
host at call time; the model cannot select or replay those fields.

“Direct” describes the Agent-facing capability, not a bypass around the host. The
adapter still calls `GenerationCanvasService`, which stages managed inputs, invokes
the exact installed Tool Plugin, validates its artifact, imports it into managed
Project storage, and commits the normal node plus guarded relations. The raw
companion MCP server and its native `output_directory` are never exposed to
OpenCode.
