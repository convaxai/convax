#!/usr/bin/env bash

set -euo pipefail

solo_task_id=""
solo_task_label=""
solo_task_worktree="$(pwd)"
solo_task_dry_run="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      solo_task_dry_run="true"
      shift
      ;;
    --id)
      solo_task_id="${2:-}"
      shift 2
      ;;
    --label)
      solo_task_label="${2:-}"
      shift 2
      ;;
    --worktree)
      solo_task_worktree="${2:-}"
      shift 2
      ;;
    *)
      printf 'solo-task: unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ ! "$solo_task_id" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
  printf 'solo-task: invalid --id\n' >&2
  exit 2
fi
solo_task_script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
solo_task_label="$(python3 "$solo_task_script_directory/solo_task_identity.py" --label "$solo_task_label")" || exit $?

solo_task_worktree="$(cd "$solo_task_worktree" && pwd -P)"
solo_task_git_root="$(git -C "$solo_task_worktree" rev-parse --show-toplevel)"
solo_task_git_root="$(cd "$solo_task_git_root" && pwd -P)"
if [[ "$solo_task_git_root" != "$solo_task_worktree" ]]; then
  printf 'solo-task: --worktree must be a Git worktree root\n' >&2
  exit 2
fi
if [[ ! -f "$solo_task_worktree/package.json" || ! -f "$solo_task_worktree/bun.lock" ]]; then
  printf 'solo-task: Convax package.json or bun.lock is missing\n' >&2
  exit 2
fi

solo_task_git_directory="$(git -C "$solo_task_worktree" rev-parse --absolute-git-dir)"
solo_task_runtime_root="$solo_task_git_directory/solo-task/runtime/$solo_task_id"
solo_task_user_data="$solo_task_runtime_root/user-data"

printf 'SOLO_TASK_ID=%s\n' "$solo_task_id"
printf 'SOLO_TASK_LABEL=%s\n' "$solo_task_label"
printf 'CONVAX_USER_DATA_DIR=%s\n' "$solo_task_user_data"
printf 'CONVAX_ALLOW_MULTIPLE_INSTANCES=1\n'
printf 'WORKTREE=%s\n' "$solo_task_worktree"

if [[ "$solo_task_dry_run" == "true" ]]; then
  printf 'COMMAND=bun run dev:desktop\n'
  exit 0
fi

mkdir -p "$solo_task_user_data"
cd "$solo_task_worktree"
exec env \
  CONVAX_SOLO_TASK_ID="$solo_task_id" \
  CONVAX_SOLO_TASK_LABEL="$solo_task_label" \
  CONVAX_USER_DATA_DIR="$solo_task_user_data" \
  CONVAX_ALLOW_MULTIPLE_INSTANCES=1 \
  bun run dev:desktop
