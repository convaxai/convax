#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile


SCRIPT = Path(__file__).with_name("run-convax.sh")


def run(*arguments: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(arguments, cwd=cwd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="solo-task-convax-run-") as temporary:
        worktree = Path(temporary) / "convax"
        worktree.mkdir()
        assert run("git", "init", "--initial-branch=main", cwd=worktree).returncode == 0
        (worktree / "package.json").write_text('{"name":"fixture"}\n', encoding="utf-8")
        (worktree / "bun.lock").write_text('', encoding="utf-8")

        git_directory = Path(
            run("git", "rev-parse", "--absolute-git-dir", cwd=worktree).stdout.strip()
        )
        user_data = git_directory / "solo-task" / "runtime" / "abc123" / "user-data"
        dry_run = run(
            "bash",
            str(SCRIPT),
            "--dry-run",
            "--id",
            "abc123",
            "--label",
            "test-task",
            "--worktree",
            str(worktree),
            cwd=worktree,
        )
        assert dry_run.returncode == 0, dry_run.stderr
        assert f"CONVAX_USER_DATA_DIR={user_data}" in dry_run.stdout
        assert "CONVAX_ALLOW_MULTIPLE_INSTANCES=1" in dry_run.stdout
        assert not user_data.exists()

        unicode_label = run(
            "bash",
            str(SCRIPT),
            "--dry-run",
            "--id",
            "abc123",
            "--label",
            "🚀" * 13,
            "--worktree",
            str(worktree),
            cwd=worktree,
        )
        assert unicode_label.returncode == 0, unicode_label.stderr
        assert not user_data.exists()

        chinese_label = run(
            "bash",
            str(SCRIPT),
            "--dry-run",
            "--id",
            "abc123",
            "--label",
            "开发任务",
            "--worktree",
            str(worktree),
            cwd=worktree,
        )
        assert chinese_label.returncode == 0, chinese_label.stderr
        assert not user_data.exists()

        for label in (
            "   ",
            " leading",
            "trailing ",
            "line\nbreak",
            "tab\tlabel",
            "\u00a0leading",
            "trailing\u00a0",
        ):
            rejected = run(
                "bash",
                str(SCRIPT),
                "--dry-run",
                "--id",
                "abc123",
                "--label",
                label,
                "--worktree",
                str(worktree),
                cwd=worktree,
            )
            assert rejected.returncode == 2, (label, rejected.stdout, rejected.stderr)
            assert "normalized characters without controls" in rejected.stderr

    print("solo-task run-convax tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
