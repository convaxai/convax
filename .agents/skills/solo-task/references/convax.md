# Convax adapter

Use this adapter only when the worktree root is the Convax repository.

## Prepare

1. Confirm the base is `origin/main` unless the user explicitly selected another base.
2. Run `bun install --frozen-lockfile`; rely on Bun's global cache and macOS clonefile backend.
3. Run focused owner-package checks before the full repository gates required by the touched contracts.

## Launch

Start Desktop through the repository helper:

```bash
bash .agents/skills/solo-task/scripts/run-convax.sh \
  --id "<session-id>" \
  --label "<short-task-label>"
```

The helper binds the process to the current worktree and sets:

- `CONVAX_SOLO_TASK_ID`: stable bounded runtime identity;
- `CONVAX_SOLO_TASK_LABEL`: short user-visible environment label;
- `CONVAX_USER_DATA_DIR`: isolated Electron profile below this worktree's private Git administrative directory;
- `CONVAX_ALLOW_MULTIPLE_INSTANCES=1`: the existing development-only path that lets this task run beside another Convax checkout.

Do not launch with another worktree's dependencies or userData. Electron Vite may select a free renderer port; verify the process uses the returned worktree and userData.

## Verify runtime identity

Require all applicable evidence:

1. The window title contains the short task label.
2. A fixed bottom-right in-window badge shows the same label and does not intercept pointer input.
3. macOS Dock shows the label badge. On Windows, verify the taskbar overlay icon and accessible description.
4. A second task runtime can launch with another userData path.
5. A packaged build ignores `CONVAX_SOLO_TASK_ID`, `CONVAX_SOLO_TASK_LABEL`, and `CONVAX_USER_DATA_DIR` except for the existing explicitly bounded packaged-smoke profile.

## Required delivery gates

Follow every touched Convax `AGENTS.md`. At minimum for Desktop runtime-identity work, run:

```bash
bun --cwd packages/desktop test
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop build
bun run package:boundaries
```

Run root `bun check` when the change affects Desktop composition, persistence, or a public process boundary.
