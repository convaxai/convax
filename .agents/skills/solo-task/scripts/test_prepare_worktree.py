#!/usr/bin/env python3

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile


SCRIPT = Path(__file__).with_name("prepare_worktree.py")


def load_prepare_module():
    spec = importlib.util.spec_from_file_location("solo_task_prepare_worktree", SCRIPT)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load prepare_worktree.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(*arguments: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(arguments, cwd=cwd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def git(repo: Path, *arguments: str) -> None:
    result = run("git", *arguments, cwd=repo)
    if result.returncode != 0:
        raise AssertionError(result.stderr or result.stdout)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="solo-task-skill-") as temporary:
        root = Path(temporary)
        remote = root / "remote.git"
        source = root / "source"
        worktrees = root / "worktrees"
        git(root, "init", "--bare", "--initial-branch=main", str(remote))
        git(root, "init", "--initial-branch=main", str(source))
        git(source, "config", "user.name", "Solo Task Test")
        git(source, "config", "user.email", "solo-task@example.invalid")
        (source / "package.json").write_text('{"name":"fixture"}\n', encoding="utf-8")
        (source / ".gitignore").write_text(".env*\n!.env.example\nnode_modules/\n", encoding="utf-8")
        (source / ".env.example").write_text("TRACKED=true\n", encoding="utf-8")
        git(source, "add", ".")
        git(source, "commit", "-m", "initial")
        git(source, "remote", "add", "origin", str(remote))
        git(source, "push", "-u", "origin", "main")
        git(source, "remote", "set-head", "origin", "main")
        (source / ".env.local").write_text("SECRET=not-printed\n", encoding="utf-8")
        nested = source / "apps" / "demo"
        nested.mkdir(parents=True)
        (nested / ".env.test").write_text("NESTED=true\n", encoding="utf-8")
        dependencies = source / "node_modules"
        dependencies.mkdir()
        (dependencies / ".env.hidden").write_text("EXCLUDED=true\n", encoding="utf-8")

        result = run(
            "python3",
            str(SCRIPT),
            "--id",
            "abc123",
            "--kind",
            "feature",
            "--repo",
            str(source),
            "--task",
            "Example Feature",
            "--worktree-root",
            str(worktrees),
        )
        if result.returncode != 0:
            raise AssertionError(result.stderr or result.stdout)
        if not result.stdout.strip():
            raise AssertionError(f"prepare_worktree.py produced no JSON; stderr={result.stderr!r}")
        try:
            output = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise AssertionError(f"prepare_worktree.py output was not JSON: {result.stdout!r}") from error
        target = Path(output["worktree"])
        assert output["base"] == "origin/main"
        assert output["branch"] == "feat/example-feature-abc123"
        assert output["copiedEnvFiles"] == [".env.local", "apps/demo/.env.test"]
        assert (target / ".env.local").read_text(encoding="utf-8") == "SECRET=not-printed\n"
        assert (target / "apps" / "demo" / ".env.test").read_text(encoding="utf-8") == "NESTED=true\n"
        assert not (target / "node_modules").exists()
        assert "not-printed" not in result.stdout
        assert Path(output["manifest"]).is_file()

        invalid_label = run(
            "python3",
            str(SCRIPT),
            "--id",
            "bad789",
            "--label",
            "   ",
            "--repo",
            str(source),
            "--task",
            "Invalid Label",
            "--worktree-root",
            str(worktrees),
        )
        assert invalid_label.returncode == 1
        assert "environment label" in invalid_label.stderr
        assert not (worktrees / "feat-invalid-label-bad789").exists()

        prepare_module = load_prepare_module()
        assert prepare_module.environment_label("🚀" * 13) == "🚀" * 13
        assert prepare_module.environment_label("开发任务") == "开发任务"
        for invalid_edge in ("\u00a0leading", "trailing\u00a0"):
            try:
                prepare_module.environment_label(invalid_edge)
            except RuntimeError:
                pass
            else:
                raise AssertionError(f"Unicode edge whitespace was admitted: {invalid_edge!r}")
        original_copy = prepare_module.shutil.copy2

        def fail_copy(*_arguments, **_keywords):
            raise OSError("injected copy failure")

        prepare_module.shutil.copy2 = fail_copy
        try:
            prepare_module.prepare(
                argparse.Namespace(
                    branch=None,
                    id="rollback1",
                    kind="feature",
                    label="rollback-test",
                    repo=str(source),
                    task="Rollback Test",
                    worktree_root=str(worktrees),
                )
            )
        except RuntimeError as error:
            assert "rolled back" in str(error)
        else:
            raise AssertionError("injected environment copy failure was not raised")
        finally:
            prepare_module.shutil.copy2 = original_copy
        rollback_target = worktrees / "feat-rollback-test-rollback1"
        assert not rollback_target.exists()
        assert run("git", "show-ref", "--verify", "--quiet", "refs/heads/feat/rollback-test-rollback1", cwd=source).returncode == 1

        collision = run(
            "python3",
            str(SCRIPT),
            "--id",
            "abc123",
            "--kind",
            "feature",
            "--repo",
            str(source),
            "--task",
            "Example Feature",
            "--worktree-root",
            str(worktrees),
        )
        assert collision.returncode == 1
        assert "branch already exists" in collision.stderr

        default_location = run(
            "python3",
            str(SCRIPT),
            "--id",
            "def456",
            "--kind",
            "bugfix",
            "--repo",
            str(source),
            "--task",
            "Default Location",
        )
        if default_location.returncode != 0:
            raise AssertionError(default_location.stderr or default_location.stdout)
        default_output = json.loads(default_location.stdout)
        assert Path(default_output["worktree"]).parent == (root / ".worktrees" / "source").resolve()
        assert default_output["branch"] == "fix/default-location-def456"

    print("solo-task prepare_worktree tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
