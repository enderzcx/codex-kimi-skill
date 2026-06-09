#!/usr/bin/env python3
"""Tiny local smoke for the codex-kimi skill docs."""

from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    skill = root / "SKILL.md"
    text = skill.read_text(encoding="utf-8")
    required = ["kci delegate", "kci health --json", "raw-fallback", "image_payload_sent", "image_delivery_confirmed"]
    missing = [item for item in required if item not in text]
    if missing:
        raise SystemExit(f"missing required docs text: {', '.join(missing)}")
    print(f"OK: {root.name} docs smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
