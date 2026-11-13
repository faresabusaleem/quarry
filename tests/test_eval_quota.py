"""The quota supervisor re-runs only provider errors and waits for the Pacific-midnight reset."""

from __future__ import annotations

import importlib.util
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("eval_quota", ROOT / "scripts" / "eval_quota.py")
assert spec and spec.loader
eq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(eq)


def test_reset_is_just_after_the_next_pacific_midnight() -> None:
    dubai = ZoneInfo("Asia/Dubai")
    now = datetime(2026, 11, 14, 0, 30, tzinfo=dubai)  # 12:30 the previous day in California
    reset = eq.next_reset(now)
    assert (
        reset.astimezone(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d %H:%M")
        == "2026-11-14 00:05"
    )
    assert reset > now


def test_only_provider_errors_are_dropped(tmp_path: Path) -> None:
    path = tmp_path / "agent.jsonl"
    rows = [
        {"id": "A01", "failure": None, "success": True},
        {"id": "A02", "failure": "provider_error", "success": False},
        {"id": "A03", "failure": "wrong_result", "success": False},
    ]
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    assert eq.scored(path) == {"A01", "A03"}
    assert eq.drop_provider_errors(path, "A03") == 0  # a wrong answer is a result, kept
    assert eq.drop_provider_errors(path, "A02") == 1
    assert [r["id"] for r in eq.records(path)] == ["A01", "A03"]
