---
name: canvas-storyboard
description: Convert a script or creative brief into ordered, reviewable shot cards on the active Convax Canvas.
---

# Storyboard Builder

Use this Skill when the user provides a script, scene, or creative brief and wants
an editable shot plan on Canvas. The deliverable is a connected sequence of shot
cards, not just advice in chat.

1. Confirm the active Canvas from the authoritative Convax host context.
2. Query existing nodes and the latest revision before changing anything. Reuse
   relevant reference images or notes instead of duplicating them.
3. Break the input into 3–12 shots unless the user specifies another count. Each
   markdown card should include the shot number, framing, subject/action, camera
   movement, and dialogue or audio cue when present.
4. Add the cards with `canvas_add_resources` as `new-text` sources. Each source is
   first published as a normal Markdown file below the active Project's `Notes/`
   directory, then referenced by its Canvas card. This business operation owns file
   publication, card sizing, placement, persistence, refresh, and optional view
   effects; do not approximate those rules with raw node JSON.
5. Using only the returned node ids and current revision, arrange the cards in
   narrative order and connect each shot to the next with `canvas_apply_primitive`.
   Re-query after each revision-changing command.
6. Reveal, select, and fit the completed sequence with `canvas_view`, then summarize
   any continuity, coverage, or pacing risk that still needs a creative decision.

If the request is specifically about semantics inside a Plugin node that provides
its own companion Skill, use that Plugin's companion Skill instead.

Do not edit `.convax` files, invent Canvas ids, or recreate Canvas business rules in the Skill.
