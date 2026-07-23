---
name: storyai-3d-director-desk
description: Plan and review spatial blocking, characters, props, and camera shots in the open-source 3D Director Desk on the active Convax Canvas.
---

# 3D Director Desk

Use this Skill when the user wants to block a scene, inspect spatial relationships,
or plan cameras with a `plugin.storyai-3d-director-desk` node.

1. Stay inside the authoritative active Project and Canvas supplied by Convax.
2. Query Canvas nodes for `plugin.storyai-3d-director-desk`. If there is more than
   one, ask which stage to use; never infer another Canvas or Project.
3. Reveal, select, and fit the chosen stage when the user asks to find or work on it.
4. Read the stage node snapshot as the current scene brief. Treat its
   `metadata.convaxPluginState.directorProject` value as read-only input.
5. Turn the user's intent into concrete blocking guidance: character roles and
   relative positions, useful props, camera position/target/FOV, shot size, and any
   continuity risk. Prefer a short ordered adjustment list over generic film advice.
6. The current open-source stage is interactive but does not expose a semantic
   scene-edit command to the Agent yet. Do not write arbitrary plugin metadata or
   pretend an edit succeeded. Guide the user in the stage, then re-query when they
   ask for a review.
7. Use Canvas view operations for selection, reveal, fit-view, and notifications.
   Never read or edit `.convax` JSON directly.

Imported panoramas and captured image pixels are session-local in this first
integration. Local model import is intentionally unavailable until Convax exposes
a scoped host asset capability. The portable scene graph, transforms, cameras, and
settings are saved with the Canvas node.

The selected stage exposes a Play toolbar button. It captures exactly the current
viewport and adds one managed image frame connected from that stage on the active
Canvas; it does not export the stage's session-only capture history.
