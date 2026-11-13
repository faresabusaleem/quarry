# LinkedIn post (draft)

Every figure below comes from `evals/results/` (runs `v3-ollama-qwen3.5-9b` and
`v1/v3-heldout-ollama-qwen3.5-9b`). Suggested image: `docs/img/answer-light.png`.

---

I built Quarry, an AI data analyst for a real e-commerce warehouse (about 100k orders from the
public Olist dataset), and then measured it against the simplest thing that could work.

Quarry plans an analysis, explores the schema, writes and fixes its own SQL, draws charts, asks
when a question is ambiguous, and links every number in its answer to the query behind it. The
agent loop is about 400 lines of hand-written Python, with no framework.

The comparison: single-shot text-to-SQL with the same model (qwen3.5:9b, running locally for
$0), the same schema and the same business glossary, on 89 questions with hand-written gold SQL.

What I found:

- Overall, a draw. Agent 73%, baseline 67% on the main set. On 25 held-out questions written
  after the code freeze, baseline 68%, agent 60%. Neither gap is statistically significant.
- They fail differently. The baseline is better at questions one query can answer. The agent
  asks about ambiguous questions (75% vs 50%), still succeeds in about two thirds of the runs
  where a query failed, and answers questions about review text that the baseline refused to
  touch.
- Prompt tuning did not generalise. Two rounds of prompt and glossary fixes improved the main
  set and changed nothing on the held-out questions.
- Checks in code did. Verifying each figure in the answer against the query results, instead of
  asking the model to cite carefully, raised fully verified answers from 47% to 91%, and from
  27% to 94% on the held-out set.
- Safety does not depend on the prompt. The database is read-only at the engine level,
  model-written Python runs in an OS sandbox with no network, and the prompt-injection rows
  planted in the data never got an action out of either system.

Everything reproduces with `make eval`. The README has the full error analysis, including where
the agent loses.

Try it (Gemini free tier, so it is rate limited): https://quarry-ten-tau.vercel.app
Code: https://github.com/faresabusaleem/quarry
