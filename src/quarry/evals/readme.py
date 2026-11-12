"""Write the results tables into README.md between marker comments.

    uv run python -m quarry.evals.readme --run v3-ollama-qwen3.5-9b \\
        --before v1-ollama-qwen3.5-9b v2-ollama-qwen3.5-9b \\
        --heldout v1-heldout-ollama-qwen3.5-9b v3-heldout-ollama-qwen3.5-9b

The README's numbers are generated from the scored JSONL files, never typed by hand.
"""

from __future__ import annotations

import argparse
import json
import re

from quarry.config import ROOT
from quarry.evals.report import (
    _pct,
    category_table,
    failure_table,
    results_table,
    summarize_run,
)
from quarry.evals.runner import RESULTS

README = ROOT / "README.md"


def _block(name: str, body: str, text: str) -> str:
    pattern = re.compile(rf"(<!-- {name}:start -->\n).*?(\n<!-- {name}:end -->)", re.S)
    if not pattern.search(text):
        raise SystemExit(f"README.md has no <!-- {name}:start/end --> markers")
    return pattern.sub(lambda m: m.group(1) + body + m.group(2), text)


def _row(name: str) -> list[str]:
    d = RESULTS / name
    s = summarize_run(d)
    meta = json.loads((d / "meta.json").read_text())
    a, b = s.get("agent", {}), s.get("baseline", {})
    n_agent, n_set = a.get("n", 0), meta.get("items", 0)
    items = f"{n_agent}" if n_agent == n_set else f"{n_agent} of {n_set} (stopped)"
    return [
        f"`{name}`",
        f"`{meta.get('commit')}`",
        items,
        _pct(a.get("task_success")),
        _pct(a.get("execution_accuracy")),
        _pct(b.get("task_success")),
        _pct(b.get("execution_accuracy")),
        _pct(a.get("grounded_answer_rate")),
        f"{a.get('median_latency_s')} s",
    ]


def runs_table(runs: list[str]) -> str:
    head = [
        "Run",
        "Code",
        "Agent items",
        "Agent task success",
        "Agent exec. accuracy",
        "Baseline task success",
        "Baseline exec. accuracy",
        "Agent answers fully verified",
        "Agent median latency",
    ]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    lines += ["| " + " | ".join(_row(r)) + " |" for r in runs]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, help="the headline dev-set run")
    parser.add_argument("--before", nargs="*", default=[], help="earlier dev-set runs")
    parser.add_argument("--heldout", nargs="*", default=[], help="held-out runs, oldest first")
    args = parser.parse_args()
    run_dir = RESULTS / args.run
    s = summarize_run(run_dir)
    meta = json.loads((run_dir / "meta.json").read_text())
    header = (
        f"Run `{args.run}` · model `{meta['model']}` via {meta['provider']} · {meta['items']} "
        f"items · code `{meta.get('commit')}` · {meta['started']}\n\n"
    )
    text = README.read_text()
    text = _block("results", header + results_table(s), text)
    text = _block("categories", category_table(s), text)
    text = _block("failures", failure_table(s), text)
    text = _block("progression", runs_table([*args.before, args.run]), text)
    if args.heldout:
        text = _block("heldout", runs_table(args.heldout), text)
    README.write_text(text)
    print(f"updated README.md from {args.run}")


if __name__ == "__main__":
    main()
