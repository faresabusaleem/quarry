"""Child-process entry point for run_python. Never imported by the parent process.

Reads {"code", "frames", "memory_mb", "max_output"} as JSON on stdin and writes one JSON
object on stdout. The parent has already applied OS limits (CPU, file size, network
isolation where available) before this file starts.
"""

from __future__ import annotations

import builtins
import contextlib
import io
import json
import os
import resource
import socket
import sys
import threading
import time

ALLOWED_ROOTS = {
    "pandas",
    "numpy",
    "scipy",
    "math",
    "statistics",
    "json",
    "datetime",
    "collections",
    "itertools",
    "functools",
    "re",
    "decimal",
    "fractions",
}
SAFE_BUILTINS = {
    "abs",
    "all",
    "any",
    "bool",
    "dict",
    "divmod",
    "enumerate",
    "filter",
    "float",
    "format",
    "frozenset",
    "int",
    "isinstance",
    "issubclass",
    "len",
    "list",
    "map",
    "max",
    "min",
    "next",
    "pow",
    "print",
    "range",
    "repr",
    "reversed",
    "round",
    "set",
    "slice",
    "sorted",
    "str",
    "sum",
    "tuple",
    "zip",
    "Exception",
    "ValueError",
    "TypeError",
    "KeyError",
    "IndexError",
    "ZeroDivisionError",
    "ArithmeticError",
    "True",
    "False",
    "None",
    "iter",
    "hash",
    "type",
}


def _emit(payload: dict) -> None:
    sys.__stdout__.write(json.dumps(payload, default=str))
    sys.__stdout__.flush()


def _memory_watchdog(limit_bytes: int) -> None:
    # RLIMIT_AS is not enforced on macOS, so watch peak RSS ourselves and exit hard.
    scale = 1 if sys.platform == "darwin" else 1024  # ru_maxrss is bytes on macOS, KiB on Linux
    while True:
        if resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale > limit_bytes:
            _emit({"ok": False, "error": "memory limit exceeded"})
            os._exit(3)
        time.sleep(0.05)


def _block_network() -> None:
    def blocked(*_a: object, **_k: object) -> None:
        raise PermissionError("network access is disabled in the sandbox")

    socket.socket = blocked  # type: ignore[assignment,misc]
    socket.create_connection = blocked  # type: ignore[assignment]
    socket.getaddrinfo = blocked  # type: ignore[assignment]


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name.split(".")[0] not in ALLOWED_ROOTS:
        raise ImportError(f"import of {name!r} is not allowed")
    return builtins.__import__(name, globals, locals, fromlist, level)


def main() -> None:
    payload = json.loads(sys.stdin.read())
    limit = int(payload.get("memory_mb", 512)) * 1024 * 1024
    threading.Thread(target=_memory_watchdog, args=(limit,), daemon=True).start()
    _block_network()

    import numpy as np
    import pandas as pd

    namespace: dict[str, object] = {"pd": pd, "np": np}
    for name, frame in payload.get("frames", {}).items():
        namespace[name] = pd.DataFrame(frame["rows"], columns=frame["columns"])

    safe = {k: getattr(builtins, k) for k in SAFE_BUILTINS if hasattr(builtins, k)}
    safe["__import__"] = _safe_import
    namespace["__builtins__"] = safe

    out = io.StringIO()
    max_output = int(payload.get("max_output", 8_000))
    try:
        with contextlib.redirect_stdout(out):
            exec(compile(payload["code"], "<analysis>", "exec"), namespace)
    except BaseException as exc:  # report every failure, including SystemExit tricks
        _emit(
            {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "stdout": out.getvalue()[:max_output],
            }
        )
        return

    result = namespace.get("result")
    columns: list[str] = []
    rows: list[list[object]] = []
    if isinstance(result, pd.Series):
        result = result.reset_index()
    if isinstance(result, pd.DataFrame):
        frame = result.head(500)
        columns = [str(c) for c in frame.columns]
        rows = json.loads(frame.to_json(orient="values", date_format="iso"))
    elif result is not None:
        value = result.item() if hasattr(result, "item") else result
        columns, rows = ["result"], [[value]]
    _emit({"ok": True, "stdout": out.getvalue()[:max_output], "columns": columns, "rows": rows})


if __name__ == "__main__":
    main()
