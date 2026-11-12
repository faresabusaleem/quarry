"""Aggregate scored items into metrics and write docs/eval_report.md.

    uv run python -m quarry.evals.report                 # every run under evals/results
    uv run python -m quarry.evals.report --run ollama-qwen3.5-9b

All numbers are computed from the JSONL files written by the runner; nothing is typed in.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median
from typing import Any

from quarry.config import ROOT
from quarry.evals.runner import RESULTS

CATEGORY_ORDER = [
    "lookup",
    "aggregation",
    "join",
    "time_series",
    "multi_step",
    "followup",
    "ambiguous",
    "unsafe",
    "out_of_scope",
    "injection",
]


def _rate(xs: list[bool]) -> float | None:
    return round(sum(xs) / len(xs), 4) if xs else None


def load_records(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def metrics(recs: list[dict[str, Any]]) -> dict[str, Any]:
    answer = [r for r in recs if r["expect"] == "answer"]
    gold = [r for r in answer if r.get("exec_match") is not None]
    clarify = [r for r in recs if r["expect"] == "clarify"]
    refuse = [r for r in recs if r["expect"] == "refuse"]
    inj = [r for r in recs if r["category"] == "injection"]
    failed_first = [r for r in recs if r.get("had_failure")]
    sql_failed = [r for r in recs if {"run_sql", "run_python"} & set(r.get("failed_tools") or [])]
    by_cat: dict[str, list[bool]] = defaultdict(list)
    for r in recs:
        by_cat[r["category"]].append(bool(r["success"]))
    latencies = [r["latency_ms"] / 1000 for r in recs if r.get("latency_ms") is not None]
    return {
        "n": len(recs),
        "task_success": _rate([r["success"] for r in recs]),
        "execution_accuracy": _rate([bool(r["exec_match"]) for r in gold]),
        "execution_accuracy_any_query": _rate([bool(r.get("exec_match_any")) for r in gold]),
        "n_gold": len(gold),
        "recovery_rate": _rate([r["success"] for r in failed_first]),
        "n_failed_first": len(failed_first),
        # Runs where a query or analysis itself failed (not just a rejected answer format).
        "sql_recovery_rate": _rate([r["success"] for r in sql_failed]),
        "n_sql_failed": len(sql_failed),
        "clarification_rate": _rate([r["outcome"] == "clarify" for r in clarify]),
        "unnecessary_clarification_rate": _rate([r["outcome"] == "clarify" for r in answer]),
        "refusal_rate": _rate([r["outcome"] == "refused" for r in refuse]),
        "false_refusal_rate": _rate([r["outcome"] == "refused" for r in answer]),
        "injection_resistance": _rate([bool(r.get("resisted")) for r in inj]),
        "injection_exposed": sum(1 for r in inj if r.get("exposed")),
        "injection_success": _rate([r["success"] for r in inj]),
        "unsafe_sql_attempts_blocked": sum(len(r.get("blocked_sql") or []) for r in recs),
        # Share of delivered analyses whose every figure was verified against a result.
        "grounded_answer_rate": _rate(
            [
                not r.get("unverified")
                for r in recs
                if r["outcome"] == "answered" and r["system"] == "agent"
            ]
        ),
        "values_level_matches": sum(1 for r in gold if r.get("match_level") == "values"),
        "avg_steps": round(mean(r["steps"] for r in recs), 2) if recs else None,
        "avg_llm_calls": round(mean(r["llm_calls"] for r in recs), 2) if recs else None,
        "avg_tokens": round(mean(r["tokens"] for r in recs)) if recs else None,
        "avg_latency_s": round(mean(latencies), 1) if latencies else None,
        "median_latency_s": round(median(latencies), 1) if latencies else None,
        "local_model": bool(recs) and all(r.get("provider") == "ollama" for r in recs),
        "total_paid_equivalent_usd": round(sum(r["cost_usd"] for r in recs), 4),
        "avg_paid_equivalent_usd": round(mean(r["cost_usd"] for r in recs), 5) if recs else None,
        "by_category": {c: _rate(v) for c, v in by_cat.items()},
        "by_category_n": {c: len(v) for c, v in by_cat.items()},
        "failures": dict(Counter(r["failure"] for r in recs if r.get("failure"))),
    }


def summarize_run(run_dir: Path) -> dict[str, dict[str, Any]]:
    out = {}
    for system in ("agent", "baseline"):
        recs = load_records(run_dir / f"{system}.jsonl")
        if recs:
            out[system] = metrics(recs)
    (run_dir / "summary.json").write_text(json.dumps(out, indent=1))
    return out


# ------------------------------------------------------------------ markdown


def _pct(x: float | None) -> str:
    return "–" if x is None else f"{x * 100:.0f}%"


def _num(x: Any, fmt: str = "{:,}") -> str:
    return "–" if x is None else fmt.format(x)


def results_table(s: dict[str, dict[str, Any]]) -> str:
    a, b = s.get("agent", {}), s.get("baseline", {})
    rows = [
        ("Task success (all items)", _pct(a.get("task_success")), _pct(b.get("task_success"))),
        (
            f"Execution accuracy ({a.get('n_gold', b.get('n_gold', 0))} items with gold SQL)",
            _pct(a.get("execution_accuracy")),
            _pct(b.get("execution_accuracy")),
        ),
        (
            "Recovery from a failed query (run still succeeded)",
            f"{_pct(a.get('sql_recovery_rate'))} of {a.get('n_sql_failed', 0)} runs",
            f"{_pct(b.get('sql_recovery_rate'))} of {b.get('n_sql_failed', 0)} (no retries)",
        ),
        (
            "Recovery from any failed tool call, incl. rejected answers",
            f"{_pct(a.get('recovery_rate'))} of {a.get('n_failed_first', 0)} runs",
            "n/a",
        ),
        (
            "Correct clarification (ambiguous items)",
            _pct(a.get("clarification_rate")),
            _pct(b.get("clarification_rate")),
        ),
        (
            "Unnecessary clarification (answerable items)",
            _pct(a.get("unnecessary_clarification_rate")),
            _pct(b.get("unnecessary_clarification_rate")),
        ),
        (
            "Correct refusal (unsafe / out of scope)",
            _pct(a.get("refusal_rate")),
            _pct(b.get("refusal_rate")),
        ),
        (
            "False refusal (answerable items)",
            _pct(a.get("false_refusal_rate")),
            _pct(b.get("false_refusal_rate")),
        ),
        (
            "Injection resistance (no canary, no hijacked action)",
            _pct(a.get("injection_resistance")),
            f"{_pct(b.get('injection_resistance'))} (never reads the text)",
        ),
        (
            "Answers whose every figure matched a query result",
            _pct(a.get("grounded_answer_rate")),
            "n/a (no answer text)",
        ),
        ("Average steps", _num(a.get("avg_steps")), _num(b.get("avg_steps"))),
        ("Average LLM calls", _num(a.get("avg_llm_calls")), _num(b.get("avg_llm_calls"))),
        ("Average tokens per question", _num(a.get("avg_tokens")), _num(b.get("avg_tokens"))),
        (
            "Median latency per question",
            _num(a.get("median_latency_s"), "{} s"),
            _num(b.get("median_latency_s"), "{} s"),
        ),
        ("Actual cost", "$0", "$0"),
        (
            "Paid-tier equivalent, whole benchmark",
            "n/a (local model)"
            if a.get("local_model")
            else _num(a.get("total_paid_equivalent_usd"), "${:.4f}"),
            "n/a (local model)"
            if b.get("local_model")
            else _num(b.get("total_paid_equivalent_usd"), "${:.4f}"),
        ),
    ]
    lines = ["| Metric | Quarry agent | Single-shot baseline |", "|---|---|---|"]
    lines += [f"| {m} | {x} | {y} |" for m, x, y in rows]
    return "\n".join(lines)


def category_table(s: dict[str, dict[str, Any]]) -> str:
    a, b = s.get("agent", {}), s.get("baseline", {})
    cats = [
        c for c in CATEGORY_ORDER if c in a.get("by_category", {}) or c in b.get("by_category", {})
    ]
    lines = ["| Category | Items | Agent | Baseline |", "|---|---|---|---|"]
    for c in cats:
        n = a.get("by_category_n", {}).get(c) or b.get("by_category_n", {}).get(c)
        lines.append(
            f"| {c.replace('_', ' ')} | {n} | {_pct(a.get('by_category', {}).get(c))} | {_pct(b.get('by_category', {}).get(c))} |"
        )
    return "\n".join(lines)


def failure_table(s: dict[str, dict[str, Any]]) -> str:
    a, b = s.get("agent", {}).get("failures", {}), s.get("baseline", {}).get("failures", {})
    kinds = sorted(set(a) | set(b), key=lambda k: -(a.get(k, 0) + b.get(k, 0)))
    lines = ["| Failure type | Agent | Baseline |", "|---|---|---|"]
    lines += [f"| {k.replace('_', ' ')} | {a.get(k, 0)} | {b.get(k, 0)} |" for k in kinds]
    return "\n".join(lines)


def failure_list(run_dir: Path, system: str) -> str:
    recs = [r for r in load_records(run_dir / f"{system}.jsonl") if not r["success"]]
    lines = ["| Item | Category | Failure | Detail |", "|---|---|---|---|"]
    for r in recs:
        detail = r.get("match_reason") or r.get("error") or r.get("outcome") or ""
        if r.get("leaked_canaries"):
            detail = f"leaked {r['leaked_canaries']}"
        detail = str(detail).replace("|", "/").replace("\n", " ")[:140]
        lines.append(
            f"| {r['id']} | {r['category']} | {(r.get('failure') or '').replace('_', ' ')} | {detail} |"
        )
    return "\n".join(lines)


def write_report(run_dir: Path, path: Path | None = None) -> Path:
    s = summarize_run(run_dir)
    meta = (
        json.loads((run_dir / "meta.json").read_text()) if (run_dir / "meta.json").exists() else {}
    )
    path = path or ROOT / "docs" / "eval_report.md"
    analysis = run_dir / "analysis.md"
    parts = [
        "# Evaluation report",
        "",
        f"Generated by `make eval` from `{run_dir.relative_to(ROOT)}`. Provider `{meta.get('provider')}`, "
        f"model `{meta.get('model')}`, {meta.get('items')} benchmark items, run started {meta.get('started')}.",
        "Every number below is computed from the per-item JSONL files in that folder.",
        "",
        "## Agent vs baseline",
        "",
        results_table(s),
        "",
        "## Success by category",
        "",
        category_table(s),
        "",
        "## Failure types",
        "",
        failure_table(s),
        "",
    ]
    if analysis.exists():
        parts += [analysis.read_text().strip(), ""]
    parts += [
        "## Every failed item (agent)",
        "",
        failure_list(run_dir, "agent"),
        "",
        "## Every failed item (baseline)",
        "",
        failure_list(run_dir, "baseline"),
        "",
    ]
    path.write_text("\n".join(parts))
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", help="results folder under evals/results")
    parser.add_argument("--out", help="markdown output path")
    args = parser.parse_args()
    if args.run:
        run_dir = RESULTS / args.run
    else:
        runs = [p for p in RESULTS.iterdir() if p.is_dir() and p.name != "offline-smoke"]
        run_dir = max(runs, key=lambda p: p.stat().st_mtime)
    out = write_report(run_dir, Path(args.out) if args.out else None)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
