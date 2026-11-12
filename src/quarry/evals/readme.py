"""Write the results tables into README.md between marker comments.

    uv run python -m quarry.evals.readme --run v2-ollama-qwen3.5-9b --before v1-ollama-qwen3.5-9b

The README's numbers are generated from the scored JSONL files, never typed by hand.
"""

from __future__ import annotations

import argparse
import json
import re

from quarry.config import ROOT
from quarry.evals.report import _pct, category_table, failure_table, results_table, summarize_run
from quarry.evals.runner import RESULTS

README = ROOT / "README.md"


def _block(name: str, body: str, text: str) -> str:
    pattern = re.compile(rf"(<!-- {name}:start -->\n).*?(\n<!-- {name}:end -->)", re.S)
    if not pattern.search(text):
        raise SystemExit(f"README.md has no <!-- {name}:start/end --> markers")
    return pattern.sub(lambda m: m.group(1) + body + m.group(2), text)


def progression(runs: list[str]) -> str:
    rows = [
        "| Run | Commit | Agent task success | Agent execution accuracy | Baseline task success | Baseline execution accuracy |",
        "|---|---|---|---|---|---|",
    ]
    for name in runs:
        d = RESULTS / name
        s = summarize_run(d)
        meta = json.loads((d / "meta.json").read_text())
        a, b = s.get("agent", {}), s.get("baseline", {})
        rows.append(
            f"| `{name}` | `{meta.get('commit')}` | {_pct(a.get('task_success'))} | {_pct(a.get('execution_accuracy'))} "
            f"| {_pct(b.get('task_success'))} | {_pct(b.get('execution_accuracy'))} |"
        )
    return "\n".join(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, help="the headline run")
    parser.add_argument(
        "--before", nargs="*", default=[], help="earlier runs for the progression table"
    )
    args = parser.parse_args()
    run_dir = RESULTS / args.run
    s = summarize_run(run_dir)
    meta = json.loads((run_dir / "meta.json").read_text())
    header = (
        f"Run `{args.run}` · model `{meta['model']}` via {meta['provider']} · {meta['items']} items · "
        f"commit `{meta.get('commit')}` · {meta['started']}\n\n"
    )
    text = README.read_text()
    text = _block("results", header + results_table(s), text)
    text = _block("categories", category_table(s), text)
    text = _block("failures", failure_table(s), text)
    text = _block("progression", progression([*args.before, args.run]), text)
    README.write_text(text)
    print(f"updated README.md from {args.run}")


if __name__ == "__main__":
    main()
