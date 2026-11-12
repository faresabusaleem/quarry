"""Benchmark items and their ground truth.

Gold results come from running the hand-written gold_sql against the warehouse; they are
stored in gold.json so reviewers can read the expected answers without building anything.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

from quarry.tools.db import Database, execute_with_limits, to_jsonable

HERE = Path(__file__).parent
BENCHMARK = HERE / "benchmark.yaml"
GOLD = HERE / "gold.json"


class Item(BaseModel):
    id: str
    category: str
    question: str
    expect: Literal["answer", "clarify", "refuse"]
    gold_sql: str | None = None
    ordered: bool = False
    context: list[str] = Field(default_factory=list)
    injection: bool = False
    notes: str | None = None


class Gold(BaseModel):
    columns: list[str]
    types: list[str]
    rows: list[list[Any]]


def load_items(path: Path = BENCHMARK) -> list[Item]:
    items = [Item.model_validate(x) for x in yaml.safe_load(path.read_text())]
    ids = [i.id for i in items]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise ValueError(f"duplicate benchmark ids: {sorted(dupes)}")
    return items


def build_gold(db: Database, items: list[Item]) -> dict[str, Gold]:
    out: dict[str, Gold] = {}
    cur = db.cursor()
    for item in items:
        if not item.gold_sql:
            continue
        res = execute_with_limits(cur, item.gold_sql, max_rows=1000, timeout_s=60)
        if res.truncated:
            raise ValueError(f"{item.id}: gold result is larger than 1,000 rows")
        out[item.id] = Gold(columns=res.columns, types=res.types, rows=to_jsonable(res.rows))
    return out


def load_gold(path: Path = GOLD) -> dict[str, Gold]:
    if not path.exists():
        return {}
    return {k: Gold.model_validate(v) for k, v in json.loads(path.read_text()).items()}


def main() -> None:
    from quarry.config import get_settings

    settings = get_settings()
    items = load_items()
    gold = build_gold(Database(settings.db_path), items)
    GOLD.write_text(json.dumps({k: v.model_dump() for k, v in gold.items()}, indent=1, default=str))
    counts: dict[str, int] = {}
    for i in items:
        counts[i.category] = counts.get(i.category, 0) + 1
    print(f"{len(items)} items, {len(gold)} with gold results -> {GOLD.name}")
    print(", ".join(f"{k}: {v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
