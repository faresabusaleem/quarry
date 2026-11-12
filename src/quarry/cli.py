"""Command line: `quarry ask "question"` runs the agent in the terminal with live steps."""

from __future__ import annotations

import argparse
import json
import sys

from quarry.agent import events as ev
from quarry.agent.loop import Agent
from quarry.agent.memory import Session
from quarry.agent.trace import TraceRecorder
from quarry.config import get_settings
from quarry.llm.factory import get_provider
from quarry.tools.db import get_database


def _print(event: ev.Event) -> None:
    d = event.data
    t = event.type
    if t == ev.PLAN:
        print("PLAN")
        for i, s in enumerate(d["steps"], 1):
            print(f"  {i}. {s}")
    elif t == ev.LLM_CALL:
        print(
            f"  · llm {d['purpose']}: {d['input_tokens']}+{d['output_tokens']} tok, {d['latency_ms']} ms"
        )
    elif t == ev.NOTE:
        print(f"  » {d['text'][:300]}")
    elif t == ev.TOOL_CALL:
        args = json.dumps(d["args"], ensure_ascii=False)
        print(f"[{event.step}] {d['tool']} {args[:400]}")
    elif t == ev.TOOL_RESULT:
        mark = "ok" if d["ok"] else "ERROR"
        first = (d.get("error") or d["content"]).splitlines()[0][:200]
        print(f"     -> {mark}: {first}")
    elif t == ev.REFLECTION:
        print(f"  ~ reflect ({d['kind']}): {str(d['message'])[:200]}")
    elif t == ev.WAITING:
        print(f"  … waiting {d['seconds']}s ({d['reason']})")
    elif t == ev.CLARIFICATION:
        print(f"\nQUESTION: {d['question']}  options: {d['options']}")
    elif t == ev.FINAL:
        answer = d["answer"]
        for c in d.get("citations", []):
            answer = answer.replace(f"[{c['id']}]", f"{c['text']}⟨{c['source_id']}⟩")
        print(f"\nANSWER ({d['status']}): {answer}")
        for c in d.get("caveats", []):
            print(f"  caveat: {c}")
        if d.get("unverified"):
            print(f"  unverified: {d['unverified']}")
    elif t == ev.ERROR:
        print(f"ERROR: {d['message']}")
    elif t == ev.RUN_FINISHED:
        print(
            f"\n[{d['status']}] {d['steps']} steps, {d['llm_calls']} LLM calls, "
            f"{d['total_tokens']} tokens, {d['latency_ms'] / 1000:.1f}s, ${d['cost_usd']:.5f} paid-equivalent"
        )


def main() -> None:
    parser = argparse.ArgumentParser(prog="quarry")
    sub = parser.add_subparsers(dest="cmd", required=True)
    ask = sub.add_parser("ask", help="ask a question (interactive follow-ups with -i)")
    ask.add_argument("question")
    ask.add_argument("-i", "--interactive", action="store_true")
    args = parser.parse_args()

    settings = get_settings()
    agent = Agent(get_provider(settings), get_database(str(settings.db_path)), settings)
    session = Session()
    message = args.question
    while True:
        recorder = TraceRecorder(settings.trace_dir)
        for event in recorder.record(agent.run(message, session)):
            _print(event)
        print(f"trace: {recorder.path}")
        if not args.interactive:
            break
        try:
            message = input("\nfollow-up> ").strip()
        except EOFError:
            break
        if not message:
            break
    sys.exit(0)


if __name__ == "__main__":
    main()
