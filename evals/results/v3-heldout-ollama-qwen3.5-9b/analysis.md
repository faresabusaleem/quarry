## Held-out analysis (v1 vs v3)

The held-out set (25 new questions) was written after v3 was frozen and committed separately
(`e07bf01`). The v1 code (`657a20f`: agent, prompts, glossary and baseline exactly as they were)
was run on it with the current scoring harness, so the two versions are compared on questions
neither was tuned on.

| Held-out, 25 items | v1 | v3 |
|---|---|---|
| Agent task success | 15 | 15 |
| Baseline task success | 18 | 17 |
| Agent answers with unverified figures | 16 | 1 |
| Agent median latency | 51.9 s | 44.1 s |

**The prompt and glossary changes did not generalise to accuracy.** The agent solved the same
number of unseen questions before and after them. Three items flipped each way: H08, H15 and H20
were fixed; H05, H14 and H25 broke. With a 9B model and 25 items, that is within noise. The
dev-set gains that motivated those changes were, at least in part, fitted to the dev set.

**The engineering changes did generalise.** Checking figures against results, instead of asking
the model to format citations, cut flagged answers from 16 to 1. It also removed the extra calls
the model used to spend rewriting answers, so the median run is 15% faster.

**v3's remaining failures on held-out (diagnosed, not tuned on):**

- Definitions misapplied: the status filter was added to payments (H03) and reviews (H05) and left
  off an order count (H11).
- Too many rows for "which is the most" questions (H09, H12).
- Stuck on a SQL error: H14 used `OR` as a table alias and resent the same query five times,
  because the checker's sqlglot message did not explain the problem. The same pattern appears
  in dev-set traces (v1 L06 and M11). A fix that reports DuckDB's own parser error was committed
  after this run (`44ceac2`) and is not measured here.
- H13 got lost in GROUP BY errors and a too-many-series chart attempt.
- Clarification: it missed two of three ambiguous questions (H18, H19) and asked one it did not
  need to ("summarise the reviews written on 1 September", H25).

**What this says about the agent.** With this model, the single-shot baseline is more accurate
on questions that one well-formed query can answer: the agent's long, multi-step context makes
it lose track of definitions and answer shape. The agent's advantages show up elsewhere: asking
when a question is ambiguous (dev set), recovering from failed queries, reading untrusted text
without being hijacked, and an answer whose every figure links to its source.
