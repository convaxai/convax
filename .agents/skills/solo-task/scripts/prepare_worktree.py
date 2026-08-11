#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys

from solo_task_identity import environment_label


KIND_PREFIX = {"bugfix": "fix", "chore": "chore", "feature": "feat", "fix": "fix", "refactor": "chore"}
EXCLUDED_PARTS = {".git", ".turbo", ".worktrees", "dist", "node_modules", "out"}
MAX_ENV_FILE_BYTES = 1024 * 1024


def run_git(repo: Path, *arguments: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *arguments],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "Git command failed"
        raise RuntimeError(detail)
    return result.stdout.strip()


def repository_root(requested: str) -> Path:
    candidate = Path(requested).expanduser().resolve()
    return Path(run_git(candidate, "rev-parse", "--show-toplevel")).resolve()


def default_remote_ref(repo: Path) -> str:
    run_git(repo, "fetch", "origin", "--prune")
    symbolic = run_git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD", check=False)
    if symbolic.startswith("origin/"):
        return symbolic
    advertised = run_git(repo, "ls-remote", "--symref", "origin", "HEAD")
    for line in advertised.splitlines():
        match = re.fullmatch(r"ref: refs/heads/([^\s]+)\s+HEAD", line)
        if match:
            return f"origin/{match.group(1)}"
    raise RuntimeError("origin does not advertise a default branch")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    if not slug:
        raise RuntimeError("task summary must contain an ASCII letter or digit")
    return slug[:40].rstrip("-")


def generated_identity(repo: Path, task: str) -> str:
    del repo, task
    return secrets.token_hex(3)


def worktree_root(repo: Path, requested: str | None) -> Path:
    if requested:
        return Path(requested).expanduser().resolve()
    common = Path(run_git(repo, "rev-parse", "--git-common-dir"))
    if not common.is_absolute():
        common = (repo / common).resolve()
    if common.name != ".git":
        raise RuntimeError("default worktree root requires a non-bare repository with a .git common directory")
    repository = common.parent
    return repository.parent / ".worktrees" / repository.name


def git_paths(repo: Path, *arguments: str) -> set[Path]:
    result = subprocess.run(
        ["git", "-C", str(repo), "ls-files", "-z", *arguments, "--", ":(glob).env*", ":(glob)**/.env*"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip() or "Could not enumerate environment files")
    return {Path(value.decode("utf-8")) for value in result.stdout.split(b"\0") if value}


def local_environment_files(repo: Path) -> list[Path]:
    candidates = git_paths(repo, "--others", "--exclude-standard") | git_paths(
        repo, "--others", "--ignored", "--exclude-standard"
    )
    admitted: list[Path] = []
    for relative in sorted(candidates):
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        source = repo / relative
        metadata = source.lstat()
        if not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"environment path must be a regular file: {relative.as_posix()}")
        if metadata.st_size > MAX_ENV_FILE_BYTES:
            raise RuntimeError(f"environment file exceeds 1 MiB: {relative.as_posix()}")
        admitted.append(relative)
    return admitted


def branch_exists(repo: Path, branch: str) -> bool:
    local_result = subprocess.run(
        ["git", "-C", str(repo), "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"], check=False
    )
    if local_result.returncode == 0:
        return True
    remote_result = subprocess.run(
        ["git", "-C", str(repo), "show-ref", "--verify", "--quiet", f"refs/remotes/origin/{branch}"],
        check=False,
    )
    return remote_result.returncode == 0


def rollback_created_worktree(source: Path, target: Path, branch: str) -> list[str]:
    failures: list[str] = []
    remove = subprocess.run(
        ["git", "-C", str(source), "worktree", "remove", "--force", str(target)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if remove.returncode != 0:
        failures.append(remove.stderr.strip() or remove.stdout.strip() or "could not remove worktree")
    delete_branch = subprocess.run(
        ["git", "-C", str(source), "branch", "-D", branch],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if delete_branch.returncode != 0:
        failures.append(delete_branch.stderr.strip() or delete_branch.stdout.strip() or "could not delete branch")
    return failures


def prepare(arguments: argparse.Namespace) -> dict[str, object]:
    source = repository_root(arguments.repo)
    base = default_remote_ref(source)
    task_slug = slugify(arguments.task)
    session_id = arguments.id or generated_identity(source, arguments.task)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,31}", session_id):
        raise RuntimeError("session id must match [a-z0-9][a-z0-9-]{0,31}")
    prefix = KIND_PREFIX[arguments.kind]
    branch = arguments.branch or f"{prefix}/{task_slug}-{session_id}"
    validation = subprocess.run(
        ["git", "check-ref-format", "--branch", branch],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if validation.returncode != 0:
        raise RuntimeError(f"invalid branch name: {branch}")
    if branch_exists(source, branch):
        raise RuntimeError(f"branch already exists: {branch}")
    label = environment_label(arguments.label if arguments.label is not None else task_slug[:24].rstrip("-"))

    root = worktree_root(source, arguments.worktree_root)
    target = root / branch.replace("/", "-")
    if target.exists() or target.is_symlink():
        raise RuntimeError(f"worktree path already exists: {target}")
    env_files = local_environment_files(source)

    root.mkdir(parents=True, exist_ok=True)
    run_git(source, "worktree", "add", "-b", branch, str(target), base)
    try:
        for relative in env_files:
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / relative, destination, follow_symlinks=False)

        git_directory = Path(run_git(target, "rev-parse", "--absolute-git-dir"))
        session_directory = git_directory / "solo-task" / "sessions"
        session_directory.mkdir(parents=True, exist_ok=True)
        manifest = {
            "base": base,
            "branch": branch,
            "copiedEnvFiles": [path.as_posix() for path in env_files],
            "id": session_id,
            "label": label,
            "repo": str(source),
            "version": 1,
            "worktree": str(target),
        }
        manifest_path = session_directory / f"{session_id}.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception as error:
        cleanup_failures = rollback_created_worktree(source, target, branch)
        cleanup_detail = f"; cleanup also failed: {'; '.join(cleanup_failures)}" if cleanup_failures else ""
        raise RuntimeError(f"worktree preparation failed and was rolled back: {error}{cleanup_detail}") from error
    return {**manifest, "manifest": str(manifest_path)}


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Create one isolated task branch and Git worktree.")
    result.add_argument("--branch")
    result.add_argument("--id")
    result.add_argument("--kind", choices=sorted(KIND_PREFIX), default="feature")
    result.add_argument("--label")
    result.add_argument("--repo", default=os.getcwd())
    result.add_argument("--task", required=True)
    result.add_argument("--worktree-root")
    return result


def main() -> int:
    try:
        output = prepare(parser().parse_args())
    except (OSError, RuntimeError) as error:
        print(f"solo-task: {error}", file=sys.stderr)
        return 1
    print(json.dumps(output, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
