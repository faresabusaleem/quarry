"""Execution-accuracy matching between a predicted result and the gold result.

Rules (documented in the README so the numbers can be audited):
- Same number of rows. Row order matters only when the item is marked `ordered`.
- Every gold column must be matched by some predicted column; extra predicted columns are
  allowed (an analyst may add context such as a count next to a revenue).
- Numbers match within 0.5% relative or 0.011 absolute tolerance, so display rounding to two
  decimals is fine. A whole column may be scaled by 100 (share shown as a percentage).
- Text compares case-insensitively; dates compare at the precision both sides share
  ("2018-01" equals "2018-01-01", a timestamp equals its date when the time is midnight).
- Fallback "values" level: if label columns are written differently (True/False versus
  'late'/'on time'), the item still passes when every numeric gold column matches row for
  row and those numbers are distinctive (not just small integers that could match by luck).
"""

from __future__ import annotations

import datetime as dt
import math
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

SCALES = (1.0, 100.0, 0.01)
_NUM = re.compile(r"^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$")
_DATE = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?")


@dataclass
class MatchResult:
    ok: bool
    level: str = ""  # "exact" | "values" | ""
    reason: str = ""


def normalize(v: Any) -> Any:
    """Map a cell to float, canonical date string, lower-case text or None."""
    if v is None:
        return None
    if isinstance(v, bool):
        return ("bool", v)
    if isinstance(v, int | float | Decimal):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, dt.datetime | dt.date):
        v = v.isoformat()
    s = str(v).strip()
    if _NUM.match(s):
        return float(s)
    m = _DATE.match(s)
    if m and len(s) <= 32:
        y, mo, d, hh, mm, ss = m.groups()
        if hh and (hh, mm, ss or "00") != ("00", "00", "00"):
            return f"{y}-{mo}-{d}T{hh}:{mm}:{ss or '00'}"
        return f"{y}-{mo}-{d}" if d else f"{y}-{mo}"
    return s.lower()


def _date_eq(a: str, b: str) -> bool:
    if a == b:
        return True
    short, long = (a, b) if len(a) < len(b) else (b, a)
    # '2018-01' vs '2018-01-01'; '2018-01-05' vs '2018-01-05T...' never reaches here.
    return bool(re.fullmatch(r"\d{4}-\d{2}", short)) and long == f"{short}-01"


def value_eq(g: Any, p: Any, scale: float = 1.0) -> bool:
    if g is None or p is None:
        return g is None and p is None
    if isinstance(g, tuple) or isinstance(p, tuple):  # booleans
        gb = g[1] if isinstance(g, tuple) else g
        pb = p[1] if isinstance(p, tuple) else p
        if isinstance(gb, bool) and isinstance(pb, float):
            return float(gb) == pb
        if isinstance(pb, bool) and isinstance(gb, float):
            return float(pb) == gb
        return gb == pb
    if isinstance(g, float) and isinstance(p, float):
        return math.isclose(g * scale, p, rel_tol=5e-3, abs_tol=0.011)
    if isinstance(g, float) and isinstance(p, str):
        # A year (2017) against a year-start date ('2017-01-01').
        return g.is_integer() and 1900 <= g <= 2100 and p in (f"{int(g)}-01-01", f"{int(g)}-01")
    if isinstance(g, str) and isinstance(p, float):
        return value_eq(p, g)
    if isinstance(g, str) and isinstance(p, str):
        if _DATE.match(g) and _DATE.match(p):
            return _date_eq(g, p)
        return g == p
    return False


def _rows_eq(gold: list[tuple], pred: list[tuple], scales: list[float], ordered: bool) -> bool:
    def row_eq(gr: tuple, pr: tuple) -> bool:
        return all(value_eq(g, p, s) for g, p, s in zip(gr, pr, scales, strict=True))

    if ordered:
        return all(row_eq(g, p) for g, p in zip(gold, pred, strict=True))
    unused = list(range(len(pred)))
    for gr in gold:
        hit = next((i for i in unused if row_eq(gr, pred[i])), None)
        if hit is None:
            return False
        unused.remove(hit)
    return True


def _column_candidates(
    g_col: list[Any], pred_cols: list[list[Any]], ordered: bool
) -> list[tuple[int, float]]:
    out = []
    for k, p_col in enumerate(pred_cols):
        for s in SCALES:
            if ordered:
                ok = all(value_eq(g, p, s) for g, p in zip(g_col, p_col, strict=True))
            else:
                ok = _rows_eq([(g,) for g in g_col], [(p,) for p in p_col], [s], ordered=False)
            if ok:
                out.append((k, s))
    return out


def _assign(
    gold_rows: list[tuple],
    pred_rows: list[tuple],
    gold_idx: list[int],
    pred_cols: list[list[Any]],
    gold_cols: list[list[Any]],
    ordered: bool,
) -> bool:
    cands = {j: _column_candidates(gold_cols[j], pred_cols, ordered) for j in gold_idx}
    if any(not c for c in cands.values()):
        return False
    order = sorted(gold_idx, key=lambda j: len(cands[j]))

    def search(i: int, used: set[int], chosen: list[tuple[int, int, float]]) -> bool:
        if i == len(order):
            g = [tuple(r[j] for j, _, _ in chosen) for r in gold_rows]
            p = [tuple(r[k] for _, k, _ in chosen) for r in pred_rows]
            return _rows_eq(g, p, [s for _, _, s in chosen], ordered)
        j = order[i]
        for k, s in cands[j]:
            if k in used:
                continue
            if search(i + 1, used | {k}, [*chosen, (j, k, s)]):
                return True
        return False

    return search(0, set(), [])


def _is_label(col: list[Any]) -> bool:
    return any(not isinstance(v, float) for v in col if v is not None)


def _distinctive(col: list[Any]) -> bool:
    nums = [v for v in col if isinstance(v, float)]
    return any(not v.is_integer() or abs(v) >= 10 for v in nums)


def match(
    gold_columns: list[str],
    gold_rows: list[list[Any]],
    pred_columns: list[str],
    pred_rows: list[list[Any]],
    *,
    ordered: bool = False,
) -> MatchResult:
    if len(gold_rows) != len(pred_rows):
        return MatchResult(False, reason=f"row count {len(pred_rows)} != gold {len(gold_rows)}")
    if not gold_rows:
        return MatchResult(True, "exact")
    g = [tuple(normalize(v) for v in r) for r in gold_rows]
    p = [tuple(normalize(v) for v in r) for r in pred_rows]
    g_cols = [list(c) for c in zip(*g, strict=True)]
    p_cols = [list(c) for c in zip(*p, strict=True)] if p and p[0] else []
    if not p_cols:
        return MatchResult(False, reason="prediction has no columns")

    all_idx = list(range(len(gold_columns)))
    if _assign(g, p, all_idx, p_cols, g_cols, ordered):
        return MatchResult(True, "exact")

    numeric_idx = [j for j in all_idx if not _is_label(g_cols[j])]
    if (
        numeric_idx
        and len(numeric_idx) < len(all_idx)
        and any(_distinctive(g_cols[j]) for j in numeric_idx)
        and _assign(g, p, numeric_idx, p_cols, g_cols, ordered)
    ):
        return MatchResult(True, "values")

    missing = [
        gold_columns[j] for j in all_idx if not _column_candidates(g_cols[j], p_cols, ordered)
    ]
    if missing:
        return MatchResult(False, reason=f"no predicted column matches gold column(s) {missing}")
    return MatchResult(False, reason="columns match individually but rows do not line up")
