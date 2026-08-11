# Plugin Internationalization

Status: current Plugin authoring contract.

Convax Plugins localize two different surfaces through one SDK-owned resource:

- Host-rendered metadata and contributions, including Plugin name, description,
  Canvas commands, selection actions, dialogs, and notifications;
- text rendered inside a sandboxed Web Plugin, including its labels and
  Plugin-owned user-facing error explanations.

The Host supplies only the current application locale. It does not translate
Plugin text, expose the app's internal i18n instance, or let locale influence
grants, routing, ActiveSet selection, or persistence.

## Ownership

| Concern                                                      | Owner                            |
| ------------------------------------------------------------ | -------------------------------- |
| `manifest.i18n`, locale and message-key validation, fallback | `@convax/plugin-sdk`             |
| `host.locale.get` request/result and availability            | `@convax/plugin-api` Catalog 3.1 |
| persisted application-language preference                    | Desktop Renderer                 |
| exact-connection locale mirror and change delivery           | Desktop Renderer/Main adapter    |
| Plugin UI rendering and Plugin-owned error wording           | the Plugin                       |

A manifest that declares `i18n` must list `host.locale.get` in
`hostApi.required`. This prevents a localized Plugin from activating on a Host that
cannot provide the language contract. Older manifests without `i18n` remain valid
and continue to use their source strings and the legacy inline `"zh-CN"` fields.

## Manifest resource

Locale keys are canonical BCP-47 tags without extensions. A package may declare at
most 16 locales, 512 messages per locale, and 256 KiB of localization data. Message
keys are stable lowercase identifiers separated by `.`, `_`, `/`, or `-`.

```json
{
  "schema": "convax.plugin/8",
  "id": "example-editor",
  "name": "Example Editor",
  "description": "Edit media in a sandboxed surface.",
  "hostApi": {
    "major": 3,
    "required": ["host.context.get", "host.locale.get"],
    "optional": []
  },
  "i18n": {
    "defaultLocale": "en",
    "messages": {
      "en": {
        "plugin.name": "Example Editor",
        "plugin.description": "Edit media in a sandboxed surface.",
        "command.preview": "Preview",
        "error.export_failed": "The export could not be completed."
      },
      "zh-CN": {
        "plugin.name": "示例编辑器",
        "plugin.description": "在沙盒界面中编辑媒体。",
        "command.preview": "预览",
        "error.export_failed": "导出未能完成。"
      }
    }
  }
}
```

`plugin.name` and `plugin.description` are reserved metadata keys. A Host-rendered
localized contribution points to any other resource entry with `key` while keeping
a mandatory bounded source fallback:

```json
{
  "id": "preview",
  "title": {
    "default": "Preview",
    "key": "command.preview"
  },
  "target": {
    "type": "renderer-message",
    "message": "preview.open"
  }
}
```

The source `default` field is never optional. It keeps the contribution readable if
the resource or key is absent and preserves compatibility with manifests that do
not use `i18n`.

## Locale inside a Web Plugin

Use the author client from `@convax/plugin-sdk/client`; do not read
`navigator.language`, Desktop storage, the parent window, or a private Host event.

```ts
import { resolvePortablePluginMessage } from "@convax/plugin-sdk"
import { createPluginHostClient } from "@convax/plugin-sdk/client"
import manifest from "../manifest.json"

const client = createPluginHostClient({ manifest, port })

let locale = await client.getLocale()

function message(key: string, fallback: string) {
  return resolvePortablePluginMessage(manifest.i18n, locale, key, fallback)
}

const stop = client.onLocaleChange((nextLocale) => {
  locale = nextLocale
  render()
})

function renderExportFailure() {
  return message("error.export_failed", "The export could not be completed.")
}

// Call stop() and client.close() when the Plugin surface is disposed.
```

The SDK makes a newer `host.locale.changed` event authoritative over an older
in-flight `getLocale()` response. The Host updates the existing MessagePort; a
language switch does not replace the iframe or reset its transient state.

## Deterministic fallback

For `zh-Hans-CN` with a declared default of `en-US`, resolution checks:

1. `zh-Hans-CN`;
2. `zh-Hans`;
3. `zh`;
4. `en-US`;
5. `en`;
6. the caller's mandatory source fallback.

Duplicate candidates are checked once. No browser negotiation, installed-locale
scan, object insertion order, or machine default participates. A legacy inline
`"zh-CN"` value remains the source fallback for that exact locale when no resource
message resolves.

## Errors

Catalog/transport failures keep their typed code, recoverability, and bounded Host
message. A Plugin must branch on the typed code and select its own user-facing
message key; it must not display raw sidecar, filesystem, network, or authorization
diagnostics. Localization changes wording only and never changes retry, billing,
cancellation, or commit semantics.

## Verification

Plugin repositories should test at least:

- exact, parent, declared-default, and source fallback;
- missing resource keys and invalid locale/message-key rejection;
- `en → zh-CN → en` without iframe remount or stale read overwrite;
- Host-rendered metadata/commands and Plugin-rendered errors;
- an existing manifest with no `i18n`.

Host contract changes additionally run Plugin API history/generation checks, Plugin
SDK tests, focused Desktop Main/Renderer/IPC tests, Desktop build, package boundary
checks, and the root repository check.
