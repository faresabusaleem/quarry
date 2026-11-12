"""The MCP server exposes the same guarded tools; check them through the protocol layer."""

from __future__ import annotations

import asyncio
import json

import pytest


@pytest.fixture(scope="module")
def mcp_server(db):  # db fixture: skip when the warehouse is not built
    from quarry.mcp import server

    return server


def text_of(result) -> str:
    return "".join(getattr(c, "text", "") for c in result.content)


def call(server_mod, name: str, args: dict) -> str:
    return text_of(asyncio.run(server_mod.server.call_tool(name, args)))


def test_lists_read_only_tools(mcp_server) -> None:
    tools = asyncio.run(mcp_server.server.list_tools())
    names = {t.name for t in tools}
    assert {
        "list_tables",
        "describe_table",
        "sample_rows",
        "run_sql",
        "make_chart",
        "ask_quarry",
    } <= names
    assert all(t.annotations and t.annotations.read_only_hint for t in tools)


def test_run_sql_then_chart_by_id(mcp_server) -> None:
    out = call(
        mcp_server,
        "run_sql",
        {
            "sql": "SELECT order_status, COUNT(*) AS n FROM orders GROUP BY 1",
            "purpose": "status mix",
        },
    )
    qid = out.split(":")[0]
    assert qid.startswith("q")
    spec = json.loads(
        call(
            mcp_server,
            "make_chart",
            {
                "source_id": qid,
                "mark": "bar",
                "x": "order_status",
                "y": "n",
                "title": "Orders by status",
            },
        )
    )
    assert spec["mark"]["type"] == "bar"


def test_guardrails_apply_over_mcp(mcp_server) -> None:
    out = call(mcp_server, "run_sql", {"sql": "DROP TABLE orders", "purpose": "evil"})
    assert "blocked by the SQL guard" in out
    out = call(
        mcp_server, "run_sql", {"sql": "SELECT * FROM read_csv('/etc/passwd')", "purpose": "exfil"}
    )
    assert "blocked" in out
