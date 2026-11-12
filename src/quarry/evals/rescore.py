"""Re-score a finished run after a scorer fix, without calling any model again.

    uv run python -m quarry.evals.rescore --run v1-ollama-qwen3.5-9b

The predicted rows come from what the run stored (pred_rows), else from the agent's trace,
else from re-executing the stored SQL against the same read-only warehouse (deterministic).
Model outputs are never changed; only the comparison with the gold result is recomputed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from quarry.config import get_settings
from quarry.evals.benchmark import SETS, load_gold, load_items
from quarry.evals.matching import match
from quarry.evals.runner import RESULTS, decide, hijacked, unsafe_sql
from quarry.tools.db import Database, execute_with_limits, to_jsonable


def _trace_sources(run_dir: Path, rec: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if not rec.get("trace"):
        return {}
    path = run_dir / "traces" / rec["trace"]
    if not path.exists():
        return {}
    events = json.loads(path.read_text())["events"]
    done = next(e for e in reversed(events) if e["type"] == "run_finished")["data"]
    srcs = {**done.get("queries", {}), **done.get("python_runs", {})}
    return {k: v for k, v in srcs.items() if v.get("ok")}


def rescore(run_dir: Path, system: str, db: Database) -> tuple[int, int]:
    meta = json.loads((run_dir / "meta.json").read_text())
    items_path, gold_path = SETS[meta.get("set", "dev")]
    items = {i.id: i for i in load_items(items_path)}
    gold = load_gold(gold_path)
    path = run_dir / f"{system}.jsonl"
    recs = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    changed = 0
    for rec in recs:
        if system == "agent" and "failed_tools" not in rec and rec.get("trace"):
            path_t = run_dir / "traces" / rec["trace"]
            if path_t.exists():
                evs = json.loads(path_t.read_text())["events"]
                rec["failed_tools"] = [
                    e["data"]["tool"]
                    for e in evs
                    if e["type"] == "tool_result" and not e["data"]["ok"]
                ]
        if system == "baseline" and "failed_tools" not in rec:
            rec["failed_tools"] = ["run_sql"] if rec["outcome"] in ("sql_error", "blocked") else []
        item, g = items[rec["id"]], gold.get(rec["id"])
        # Only forbidden queries count as unsafe or hijacked, not syntax errors (scorer fix).
        rec["unsafe_sql"] = unsafe_sql(rec.get("blocked_sql") or [])
        rec["hijacked"] = hijacked(rec)
        if item.expect != "answer" or g is None:
            before = rec.get("success")
            decide(item, rec)
            changed += int(before != rec["success"])
            continue
        sources = _trace_sources(run_dir, rec) if system == "agent" else {}
        cols: list[str] | None = rec.get("pred_columns")
        rows: list[list[Any]] | None = (
            rec.get("pred_rows") if not rec.get("pred_truncated") else None
        )
        if rows is None and rec.get("primary_id") in sources:
            cols, rows = sources[rec["primary_id"]]["columns"], sources[rec["primary_id"]]["rows"]
        if rows is None and rec.get("sql") and rec["outcome"] == "answered":
            res = execute_with_limits(db.cursor(), rec["sql"], max_rows=1000, timeout_s=60)
            cols, rows = res.columns, to_jsonable(res.rows)
        before = rec.get("success")
        if rows is not None and cols is not None:
            m = match(g.columns, g.rows, cols, rows, ordered=item.ordered)
            rec["exec_match"], rec["match_level"], rec["match_reason"] = (
                m.ok,
                m.level or None,
                m.reason or None,
            )
            if system == "agent" and sources:
                rec["exec_match_any"] = any(
                    match(g.columns, g.rows, s["columns"], s["rows"], ordered=item.ordered).ok
                    for s in sources.values()
                )
            else:
                rec["exec_match_any"] = rec["exec_match"]
        decide(item, rec)
        changed += int(before != rec["success"])
    path.write_text("".join(json.dumps(r, default=str) + "\n" for r in recs))
    return changed, len(recs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True)
    args = parser.parse_args()
    run_dir = RESULTS / args.run
    db = Database(get_settings().db_path)
    for system in ("baseline", "agent"):
        if (run_dir / f"{system}.jsonl").exists():
            changed, n = rescore(run_dir, system, db)
            print(f"{system}: {changed} of {n} items changed outcome")


if __name__ == "__main__":
    main()
