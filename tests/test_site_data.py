"""The website's numbers must come from the results files, not from hand-typed copies.

web/lib/generated/ is written by scripts/export_site_data.py. This regenerates it in memory
and fails if a committed file differs, i.e. if a result changed without re-exporting.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "web" / "lib" / "generated"


def _export_module():
    spec = importlib.util.spec_from_file_location(
        "export_site_data", ROOT / "scripts" / "export_site_data.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def built(db) -> dict:  # db: the warehouse must exist (samples read from it)
    return _export_module().build()


@pytest.mark.parametrize("name", ["results.json", "analysis.json", "samples.json"])
def test_generated_site_data_is_current(built: dict, name: str) -> None:
    committed = json.loads((GENERATED / name).read_text())
    fresh = json.loads(json.dumps(built[name], sort_keys=True))
    assert committed == fresh, f"{name} is stale: run scripts/export_site_data.py"


def test_headline_numbers_match_the_published_runs(built: dict) -> None:
    runs = built["results.json"]["runs"]
    v3 = runs["v3-dev"]
    assert v3["items"] == 89 and v3["commit"] == "e07bf01"
    assert round(v3["agent"]["task_success"] * 100) == 73
    assert round(v3["baseline"]["task_success"] * 100) == 67
    assert v3["discordant"] == {"agent_only": 17, "baseline_only": 12, "p": 0.46}
    assert runs["v3-heldout"]["discordant"] == {"agent_only": 3, "baseline_only": 5, "p": 0.73}


def test_suggested_questions_are_real_benchmark_items_the_agent_answered(built: dict) -> None:
    rows = (ROOT / "evals/results/v3-ollama-qwen3.5-9b/agent.jsonl").read_text().splitlines()
    ok = {r["id"]: r["success"] for r in map(json.loads, rows)}
    for ex in built["results.json"]["examples"]:
        assert ok[ex["id"]] is True


def test_showcase_and_recovery_are_real_traces() -> None:
    trace = json.loads((GENERATED / "showcase-trace.json").read_text())
    types = [e["type"] for e in trace["events"]]
    assert types[0] == "run_started" and types[-1] == "run_finished"
    final = next(e["data"] for e in trace["events"] if e["type"] == "final")
    assert final["status"] == "answered" and final["charts"] and not final["unverified"]
    rec = json.loads((GENERATED / "recovery.json").read_text())
    assert "blocked by the SQL guard" in rec["error"]
    assert rec["failed"]["tool"] == rec["fixed"]["tool"] == "run_sql"
