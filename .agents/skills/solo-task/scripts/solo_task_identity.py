#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys


EDGE_WHITESPACE = frozenset(
    range(0x0009, 0x000E)
) | frozenset(
    {
        0x0020,
        0x00A0,
        0x1680,
        *range(0x2000, 0x200B),
        0x2028,
        0x2029,
        0x202F,
        0x205F,
        0x3000,
        0xFEFF,
    }
)


def environment_label(value: str) -> str:
    if not value or len(value) > 24:
        raise RuntimeError("environment label must contain 1..24 normalized characters without controls")
    if ord(value[0]) in EDGE_WHITESPACE or ord(value[-1]) in EDGE_WHITESPACE:
        raise RuntimeError("environment label must contain 1..24 normalized characters without controls")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise RuntimeError("environment label must contain 1..24 normalized characters without controls")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate one solo-task environment label.")
    parser.add_argument("--label", required=True)
    arguments = parser.parse_args()
    try:
        print(environment_label(arguments.label))
    except RuntimeError as error:
        print(f"solo-task: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
