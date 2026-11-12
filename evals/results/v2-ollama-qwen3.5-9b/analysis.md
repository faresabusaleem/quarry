## Why v2 was stopped early

v2 applied every fix from the v1 error analysis. The baseline half finished (89 items) and the
agent half was stopped after 31 items (L01 to J05) because it was clearly worse on accuracy,
and four more hours would only have confirmed it.

On the 31 items both versions completed:

| | v1 | v2 |
|---|---|---|
| Agent successes | 22 | 19 |
| Baseline successes (same items) | 26 | 25 |
| Agent answers with unverified figures | 15 of 30 | 2 of 30 |
| Agent median latency | 54.9 s | 45.1 s |

Over all 89 items the v2 baseline scored 64 (v1: 62).

**What worked.** Verifying figures against results instead of policing their format took
flagged answers from half to almost none, and cut latency, because the model no longer spent
calls rewriting answers into marker syntax. Four items that failed in v1 passed: J02, which v1 lost to answer
formatting; J01 and J03, where the clearer glossary helped; and A09.

**What regressed, and why.** Seven items that passed in v1 failed in v2:

- **The glossary over-corrected.** v2 wrote the revenue definition as an SQL fragment
  (`WHERE o.order_status NOT IN ('canceled', 'unavailable')`). It made the filter so prominent
  that the model added it to freight per item (A06), catalogue weights (A10) and "delivered
  orders" (A12, where the question names the status). Making a rule more salient is not the
  same as making its scope clear.
- **A correct answer was lost to a new input shape (L07).** The model sent `citations` as a
  JSON-looking string. The v2 parser forgave malformed citation items but not a malformed list,
  and the run stopped after five identical failures.
- **The rest were variance on a 9B model:** an extra TOTAL row (A01), a detour through the
  geolocation table (A08), and the average item price instead of the average order value (A13).

**What changed for v3.**

- The glossary states definitions in plain words again, with an explicit list of where the
  status filter does not apply.
- `final_answer` treats any malformed field as recoverable: lists sent as strings are parsed or
  dropped, unknown chart ids are dropped, and a bad `result_query_id` becomes empty. If there is
  an answer, nothing else in the call can sink it.
- Because the prompts and glossary have now been changed twice in response to this benchmark,
  v3 is also scored on a held-out set of new questions. That set was written after the v3 code
  was frozen and is never used to decide changes.
