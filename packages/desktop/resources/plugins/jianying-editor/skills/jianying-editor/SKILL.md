---
name: jianying-editor
description: Export image and video nodes from the active Convax Canvas to JianYing. Use when the user asks to send, import, or export Canvas media to 剪映/JianYing, either to the currently open draft or to a new draft.
---

# JianYing Canvas export

Use only the host-provided JianYing and Canvas tools. Do not inspect native paths, edit draft JSON, run shell commands, or reproduce the native automation.

1. Query the Canvas nodes first and keep the returned document revision. Export only nodes whose kind is `image` or `video`.
2. Call `jianying_get_draft_status` immediately before deciding the target.
3. Handle the status exactly:
   - `active`: ask the user whether to import into the named current draft or create a new draft. Wait for the answer even if one choice seems more convenient.
   - `no_active_draft` or `not_running`: use target `new`; no extra question is needed.
   - `ambiguous`, `unavailable`, or `unsupported`: stop and explain the reported reason. Never reinterpret these states as no active draft.
4. Call `jianying_export_canvas_media` with the selected media node ids, latest `expectedRevision`, the returned `draftToken`, and explicit target kind `current` or `new`. The host binds the call to the live active Canvas; never supply or invent a Canvas id.
5. Report the returned draft name, imported count, and whether a new draft was created.

If the result says the native outcome is unverified or partial, do not retry automatically because a second attempt may duplicate materials.
