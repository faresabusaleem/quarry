"""Static policy for run_python code.

This is the first of several layers (see executor.py for the process-level ones). It rejects
code that imports anything outside a small analysis allow-list, touches dunder or private
attributes (the usual way out of a Python sandbox), or calls file, network or eval APIs.
"""

from __future__ import annotations

import ast

ALLOWED_MODULES = {
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

BANNED_NAMES = {
    "open",
    "exec",
    "eval",
    "compile",
    "__import__",
    "globals",
    "locals",
    "vars",
    "getattr",
    "setattr",
    "delattr",
    "input",
    "breakpoint",
    "help",
    "exit",
    "quit",
    "memoryview",
    "classmethod",
    "staticmethod",
    "property",
    "super",
    "object",
}

# Attribute names that reach files, processes, the network, or code evaluation.
BANNED_ATTRS = {
    "os",
    "sys",
    "io",
    "subprocess",
    "builtins",
    "importlib",
    "shutil",
    "socket",
    "pathlib",
    "ctypes",
    "ctypeslib",
    "pickle",
    "marshal",
    "inspect",
    "gc",
    "code",
    "runpy",
    "signal",
    "threading",
    "multiprocessing",
    "resource",
    "posix",
    "platform",
    "sysconfig",
    "site",
    "tempfile",
    "lib",
    "f2py",
    "distutils",
    "testing",
    "system",
    "popen",
    "spawn",
    "fork",
    "eval",
    "query",
    "exec",
    "load",
    "loads",
    "save",
    "savez",
    "savez_compressed",
    "savetxt",
    "loadtxt",
    "genfromtxt",
    "fromfile",
    "tofile",
    "memmap",
    "dump",
    "dumps",
    "open",
    "LowLevelCallable",
    "f_globals",
    "f_locals",
    "gi_frame",
    "cr_frame",
    "tb_frame",
    "func_globals",
    "mro",
}

# Methods named to_* that only convert in memory are fine; the rest write to disk or a DB.
SAFE_TO_METHODS = {
    "to_dict",
    "to_list",
    "to_numpy",
    "to_frame",
    "to_string",
    "to_period",
    "to_timestamp",
    "to_records",
    "to_series",
    "to_datetime",
    "to_numeric",
    "to_timedelta",
    "to_flat_index",
    "to_pydatetime",
    "to_offset",
    "to_markdown",
}


class PolicyError(ValueError):
    pass


def check_code(code: str, max_chars: int = 8_000) -> None:
    if len(code) > max_chars:
        raise PolicyError(f"code is longer than {max_chars} characters")
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise PolicyError(f"syntax error on line {exc.lineno}: {exc.msg}") from exc

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                _check_module(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise PolicyError("relative imports are not allowed")
            _check_module(node.module or "")
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            raise PolicyError(f"{node.id!r} is not available in the sandbox")
        elif isinstance(node, ast.Attribute):
            attr = node.attr
            if attr.startswith("_"):
                raise PolicyError(f"access to private attribute {attr!r} is not allowed")
            if attr in BANNED_ATTRS:
                raise PolicyError(f"attribute {attr!r} is not allowed in the sandbox")
            if attr.startswith("read_") or (attr.startswith("to_") and attr not in SAFE_TO_METHODS):
                raise PolicyError(f"{attr}() reads or writes files and is not allowed")
        elif isinstance(node, ast.Global | ast.Nonlocal):
            raise PolicyError("global/nonlocal statements are not allowed")


def _check_module(name: str) -> None:
    root = name.split(".")[0]
    if root not in ALLOWED_MODULES:
        allowed = ", ".join(sorted(ALLOWED_MODULES))
        raise PolicyError(f"import of {name!r} is not allowed. Allowed: {allowed}")
    if any(part.startswith("_") for part in name.split(".")):
        raise PolicyError(f"import of private module {name!r} is not allowed")
