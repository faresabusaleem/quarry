"""Run the benchmark on a provider with a daily request quota (the Gemini free tier).

The runner itself is unchanged: this calls `python -m quarry.evals.runner` one question and
one system at a time, so the scoring is exactly the same as for every other run. It adds two
things a free daily quota needs:

- A daily budget of model calls, so the hosted demo (same Google project) keeps some of the
  shared quota. When the budget is spent it waits for the quota reset at midnight Pacific.
- Quota failures are not scored. A question that ends in a provider error (quota refused,
  servers overloaded) says nothing about the model, so its record is removed and the
  question runs again later. Nothing else is ever re-run.

    uv run python scripts/eval_quota.py                     # dev set, then held-out
    uv run python scripts/eval_quota.py --daily-calls 300

Progress goes to evals/results/<run>/quota.log.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "evals" / "results"
PACIFIC = ZoneInfo("America/Los_Angeles")
ITEM_TIMEOUT_S = 20 * 60


def next_reset(now: datetime) -> datetime:
    """Google's free-tier daily quotas reset at midnight Pacific time."""
    local = now.astimezone(PACIFIC)
    midnight = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(now.tzinfo) + timedelta(minutes=5)


def records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def scored(path: Path) -> set[str]:
    """Items with a record that is not a provider error."""
    return {r["id"] for r in records(path) if r.get("failure") != "provider_error"}


def drop_provider_errors(path: Path, item_id: str) -> int:
    """Remove this item's provider-error records so the item is run again. Returns the count."""
    if not path.exists():
        return 0
    keep, dropped = [], 0
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r["id"] == item_id and r.get("failure") == "provider_error":
            dropped += 1
        else:
            keep.append(line)
    path.write_text("".join(f"{line}\n" for line in keep))
    return dropped


def item_ids(set_name: str) -> list[str]:
    sys.path.insert(0, str(ROOT / "src"))
    from quarry.evals.benchmark import load_items
    from quarry.evals.runner import SETS

    return [i.id for i in load_items(SETS[set_name][0])]


class Budget:
    def __init__(self, daily: int, log):
        self.daily = daily
        self.used = 0
        self.reset_at = next_reset(datetime.now().astimezone())
        self.log = log

    def wait_for_reset(self, reason: str) -> None:
        self.log(f"{reason}; waiting for the quota reset at {self.reset_at:%Y-%m-%d %H:%M %Z}")
        while datetime.now().astimezone() < self.reset_at:
            time.sleep(60)
        self.used = 0
        self.reset_at = next_reset(datetime.now().astimezone())
        self.log("quota reset; continuing")

    def before_item(self) -> None:
        if datetime.now().astimezone() >= self.reset_at:
            self.used = 0
            self.reset_at = next_reset(datetime.now().astimezone())
        if self.used >= self.daily:
            self.wait_for_reset(f"daily budget of {self.daily} calls used")


def run_set(set_name: str, run: str, budget: Budget, env: dict, log) -> None:
    out = RESULTS / run
    out.mkdir(parents=True, exist_ok=True)
    ids = item_ids(set_name)
    started = time.strftime("%Y-%m-%d %H:%M:%S")
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT
    ).stdout.strip()
    for n, item in enumerate(ids, 1):
        for system in ("baseline", "agent"):
            path = out / f"{system}.jsonl"
            failures = 0
            while item not in scored(path):
                budget.before_item()
                cmd = [sys.executable, "-m", "quarry.evals.runner", "--set", set_name]
                cmd += ["--run", run, "--system", system, "--ids", item]
                try:
                    subprocess.run(
                        cmd, cwd=ROOT, env=env, timeout=ITEM_TIMEOUT_S, capture_output=True
                    )
                except subprocess.TimeoutExpired:
                    log(f"{item} {system}: no result in {ITEM_TIMEOUT_S // 60} min")
                    budget.wait_for_reset("the provider stopped answering")
                    continue
                mine = [r for r in records(path) if r["id"] == item]
                if mine:
                    budget.used += int(mine[-1].get("llm_calls") or 1)
                if item in scored(path):
                    rec = mine[-1]
                    mark = "pass" if rec["success"] else f"fail ({rec['failure']})"
                    log(
                        f"[{set_name} {n}/{len(ids)}] {item} {system}: {mark}, {rec['llm_calls']} calls, budget {budget.used}/{budget.daily}"
                    )
                    break
                dropped = drop_provider_errors(path, item)
                failures += 1
                error = (mine[-1].get("error") or "")[:160] if mine else "no record"
                log(f"{item} {system}: provider error, record removed ({dropped}): {error}")
                if failures >= 2:
                    budget.wait_for_reset("two provider errors in a row")
                    failures = 0
                else:
                    time.sleep(90)
    # The runner rewrites meta.json per call; record the whole run.
    (out / "meta.json").write_text(
        json.dumps(
            {
                "run": run,
                "commit": commit or None,
                "provider": env.get("QUARRY_PROVIDER"),
                "model": env.get("QUARRY_MODEL") or "gemini-3.5-flash-lite",
                "items": len(ids),
                "set": set_name,
                "started": started,
                "finished": time.strftime("%Y-%m-%d %H:%M:%S"),
                "max_steps": 14,
                "quota_policy": "provider-error records removed and re-run; nothing else re-run",
            },
            indent=1,
        )
    )
    log(f"{set_name} finished: {run}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--daily-calls", type=int, default=330)
    ap.add_argument("--dev-run", default="gemini-3.5-flash-lite")
    ap.add_argument("--heldout-run", default="heldout-gemini-3.5-flash-lite")
    args = ap.parse_args()
    env = {**os.environ, "QUARRY_PROVIDER": "gemini", "QUARRY_GEMINI_RPM": "14"}
    logfile = RESULTS / args.dev_run / "quota.log"
    logfile.parent.mkdir(parents=True, exist_ok=True)

    def log(msg: str) -> None:
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
        print(line, flush=True)
        with logfile.open("a") as f:
            f.write(line + "\n")

    budget = Budget(args.daily_calls, log)
    run_set("dev", args.dev_run, budget, env, log)
    run_set("heldout", args.heldout_run, budget, env, log)
    log("all done")


if __name__ == "__main__":
    main()
