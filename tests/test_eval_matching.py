from quarry.evals.benchmark import load_gold, load_items
from quarry.evals.matching import match


def test_exact_match_ignores_column_names_and_extra_columns() -> None:
    gold = (["category", "revenue"], [["a", 10.0], ["b", 5.0]])
    pred = (["cat", "n_orders", "total"], [["A", 3, 10.004], ["B", 1, 5.0]])
    assert match(*gold, *pred).ok


def test_row_order_matters_only_when_ordered() -> None:
    gold = (["c", "v"], [["a", 10.0], ["b", 5.0]])
    pred = (["c", "v"], [["b", 5.0], ["a", 10.0]])
    assert match(*gold, *pred, ordered=False).ok
    assert not match(*gold, *pred, ordered=True).ok


def test_row_count_must_match() -> None:
    gold = (["c"], [["a"], ["b"]])
    assert not match(*gold, ["c"], [["a"], ["b"], ["c"]]).ok


def test_rounding_and_percent_scaling() -> None:
    assert match(["share"], [[0.19043952]], ["pct"], [[19.04]]).ok
    assert match(["avg"], [[137.418922]], ["avg"], [[137.42]]).ok
    assert not match(["avg"], [[137.418922]], ["avg"], [[139.0]]).ok


def test_month_and_date_representations() -> None:
    assert match(["month", "n"], [["2018-01", 5.0]], ["m", "n"], [["2018-01-01", 5]]).ok
    assert match(["first"], [["2016-09-04T21:15:19"]], ["first"], [["2016-09-04 21:15:19"]]).ok
    assert match(["year", "rev"], [[2017, 1.5]], ["y", "rev"], [["2017-01-01", 1.5]]).ok


def test_values_level_fallback_for_differently_written_labels() -> None:
    gold = (["late", "avg_score"], [[True, 2.5665], [False, 4.2937]])
    pred = (["delivery", "avg"], [["late", 2.57], ["on time", 4.29]])
    res = match(*gold, *pred)
    assert res.ok and res.level == "values"


def test_values_fallback_refuses_small_integer_coincidences() -> None:
    gold = (["state", "n"], [["SP", 1.0], ["RJ", 2.0]])
    pred = (["state", "n"], [["XX", 1], ["YY", 2]])
    assert not match(*gold, *pred).ok


def test_wrong_numbers_fail_with_a_reason() -> None:
    res = match(["rev"], [[100.0]], ["rev"], [[150.0]])
    assert not res.ok and "rev" in res.reason


def test_gold_file_covers_every_answer_item_with_sql() -> None:
    gold = load_gold()
    for item in load_items():
        if item.gold_sql:
            assert item.id in gold, f"{item.id} missing from gold.json; run `make gold`"
            assert gold[item.id].rows, f"{item.id} gold result is empty"
