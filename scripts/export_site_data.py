"""Export the data the website shows into web/lib/generated/, straight from the source files.

Every number on the landing and benchmark pages comes from here, so nothing on the site is
typed by hand. tests/test_site_data.py regenerates everything and fails if a file is stale.

    uv run python scripts/export_site_data.py            # results, analysis, samples
    uv run python scripts/export_site_data.py --showcase traces/<id>.json --recovery traces/<id>.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from scipy.stats import binomtest

from quarry.config import ROOT, get_settings
from quarry.data.schema import TABLES
from quarry.evals.benchmark import load_items
from quarry.evals.report import load_records, summarize_run
from quarry.tools.db import get_database

OUT = ROOT / "web" / "lib" / "generated"
RESULTS = ROOT / "evals" / "results"

# The measured runs the site reports, with the labels it uses.
RUNS = {
    "v1-dev": "v1-ollama-qwen3.5-9b",
    "v2-dev": "v2-ollama-qwen3.5-9b",
    "v3-dev": "v3-ollama-qwen3.5-9b",
    "v1-heldout": "v1-heldout-ollama-qwen3.5-9b",
    "v3-heldout": "v3-heldout-ollama-qwen3.5-9b",
}
# Suggested questions: real benchmark items the v3 agent answered correctly.
EXAMPLE_IDS = ["T05", "J01", "M11", "M02"]
SAMPLE_ROWS = 5


def _metrics(m: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in m.items() if k != "failures"}


def mcnemar(run_dir: Path) -> dict[str, Any]:
    """Items only one system solved, and the exact two-sided McNemar p-value."""
    agent = {r["id"]: bool(r.get("success")) for r in load_records(run_dir / "agent.jsonl")}
    base = {r["id"]: bool(r.get("success")) for r in load_records(run_dir / "baseline.jsonl")}
    ids = agent.keys() & base.keys()
    a_only = sum(agent[i] and not base[i] for i in ids)
    b_only = sum(base[i] and not agent[i] for i in ids)
    n = a_only + b_only
    p = binomtest(min(a_only, b_only), n, 0.5).pvalue if n else 1.0
    return {"agent_only": a_only, "baseline_only": b_only, "p": round(float(p), 2)}


def results() -> dict[str, Any]:
    runs: dict[str, Any] = {}
    for key, name in RUNS.items():
        d = RESULTS / name
        meta = json.loads((d / "meta.json").read_text())
        s = summarize_run(d, write=False)
        runs[key] = {
            "run": name,
            "set": meta.get("set", "dev"),
            "commit": meta.get("commit"),
            "provider": meta.get("provider"),
            "model": meta.get("model"),
            "items": meta.get("items"),
            "agent": _metrics(s["agent"]),
            "baseline": _metrics(s["baseline"]),
            "discordant": mcnemar(d),
        }
    items = {i.id: i for i in load_items()}
    examples = [{"id": i, "question": items[i].question} for i in EXAMPLE_IDS]
    return {"runs": runs, "examples": examples}


def _section(md: str, heading: str) -> str:
    m = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", md, re.S | re.M)
    if not m:
        raise SystemExit(f"README has no '## {heading}' section")
    return m.group(1).strip()


def analysis() -> dict[str, Any]:
    readme = (ROOT / "README.md").read_text()
    return {
        "dev": (RESULTS / RUNS["v3-dev"] / "analysis.md").read_text().strip(),
        "heldout": (RESULTS / RUNS["v3-heldout"] / "analysis.md").read_text().strip(),
        "limitations": _section(readme, "Limitations"),
    }


def _cell(v: Any) -> Any:
    if v is None or isinstance(v, bool | int | float | str):
        return v
    return str(v)


def samples() -> dict[str, Any]:
    s = get_settings()
    cur = get_database(str(s.db_path), s.duckdb_memory_limit).cursor()
    out: dict[str, Any] = {}
    for t in TABLES:
        cols = [c.name for c in t.columns]
        key = ", ".join(f'"{c}"' for c in cols[:2])
        rows = cur.execute(
            f'SELECT {", ".join(f"{chr(34)}{c}{chr(34)}" for c in cols)} FROM "{t.name}" '
            f"ORDER BY {key} LIMIT {SAMPLE_ROWS}"
        ).fetchall()
        out[t.name] = {"columns": cols, "rows": [[_cell(v) for v in r] for r in rows]}
    cur.close()
    return out


def build() -> dict[str, Any]:
    return {"results.json": results(), "analysis.json": analysis(), "samples.json": samples()}


def write(name: str, data: Any) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"wrote web/lib/generated/{name}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--showcase", type=Path, help="trace of the run the landing page replays")
    ap.add_argument("--recovery", type=Path, help="trace whose first error and fix are quoted")
    args = ap.parse_args()
    for name, data in build().items():
        write(name, data)
    if args.showcase:
        write("showcase-trace.json", json.loads(args.showcase.read_text()))
    if args.recovery:
        events = json.loads(args.recovery.read_text())["events"]
        err = next(
            i for i, e in enumerate(events) if e["type"] == "tool_result" and not e["data"]["ok"]
        )
        call = max(i for i in range(err) if events[i]["type"] == "tool_call")
        fix = next(
            i
            for i in range(err + 1, len(events))
            if events[i]["type"] == "tool_result" and events[i]["data"]["ok"]
        )
        fix_call = max(i for i in range(err + 1, fix) if events[i]["type"] == "tool_call")
        write(
            "recovery.json",
            {
                "run_id": events[0]["run_id"],
                "question": events[0]["data"].get("question"),
                "failed": events[call]["data"],
                "error": events[err]["data"].get("error"),
                "fixed": events[fix_call]["data"],
                "result": {k: events[fix]["data"].get(k) for k in ("content", "latency_ms")},
            },
        )


if __name__ == "__main__":
    main()
