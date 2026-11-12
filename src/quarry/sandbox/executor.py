"""Run untrusted analysis code in a separate, locked-down process.

Layers, outermost first:
1. OS isolation of the child process: on macOS `sandbox-exec` denies all network access,
   all file writes and reads of the home directory (except the Python install); on Linux
   `unshare -rn` puts the child in an empty network namespace. If neither is available,
   run_python reports itself as disabled instead of running without isolation.
2. Resource limits set before exec: CPU seconds, zero-byte file writes, no core dumps,
   address space (Linux), plus a wall-clock timeout and a peak-RSS watchdog (macOS).
3. A scrubbed environment (no API keys) and a fresh temporary working directory.
4. Inside the child: restricted builtins, an import allow-list and a disabled socket module.
5. Before any of that, policy.check_code rejects dangerous code statically.
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from quarry.sandbox.policy import PolicyError, check_code

RUNNER = Path(__file__).with_name("runner.py")


@dataclass
class SandboxResult:
    ok: bool
    stdout: str = ""
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    error: str | None = None
    elapsed_ms: float = 0.0


def _macos_profile() -> str:
    home = str(Path.home())
    allowed_reads = {sys.prefix, sys.base_prefix, sys.exec_prefix, str(RUNNER.parent)}
    allowed_reads |= {p for p in sys.path if p and Path(p).exists() and p.startswith(home)}
    # Interpreters are often reached through symlinks (venv -> uv-managed Python); the
    # sandbox checks every hop, so allow each directory on the way to the real binary.
    link = Path(sys.executable)
    for _ in range(10):
        allowed_reads.add(str(link.parent))
        if not link.is_symlink():
            break
        link = (link.parent / os.readlink(link)).absolute()
    allowed_reads.add(str(Path(sys.base_prefix).parent))
    allows = " ".join(f'(subpath "{p}")' for p in sorted(allowed_reads))
    # Later rules win in SBPL: deny broadly, then re-allow the Python install.
    return (
        "(version 1)(allow default)(deny network*)"
        '(deny file-write*)(allow file-write* (literal "/dev/null"))'
        f'(deny file-read* (subpath "{home}"))(allow file-read* {allows})'
    )


@lru_cache(maxsize=1)
def isolation_prefix() -> tuple[list[str] | None, str]:
    """Return (command prefix, description), or (None, reason) if no isolation works."""
    candidates: list[tuple[list[str], str]] = []
    if sys.platform == "darwin" and shutil.which("sandbox-exec"):
        candidates.append((["sandbox-exec", "-p", _macos_profile()], "macOS sandbox-exec"))
    if sys.platform.startswith("linux") and shutil.which("unshare"):
        candidates.append((["unshare", "-rn"], "Linux network namespace (unshare -rn)"))
    for prefix, label in candidates:
        try:
            probe = subprocess.run(
                [*prefix, sys.executable, "-I", "-c", "pass"], capture_output=True, timeout=10
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if probe.returncode == 0:
            return prefix, label
    return None, "no OS-level network isolation is available on this host"


def child_env(workdir: str) -> dict[str, str]:
    """A fixed, minimal environment: nothing from the parent (API keys included) leaks in."""
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": workdir,
        "LANG": "C.UTF-8",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
    }


def _limits(cpu_s: int, memory_mb: int) -> None:  # runs in the child before exec
    import resource

    os.setsid()  # own process group, so a timeout kills every descendant
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)  # writes fail with an error instead
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if sys.platform.startswith("linux"):
        limit = memory_mb * 1024 * 1024 * 4  # address space is larger than RSS (BLAS, mmap)
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def run_python(
    code: str,
    frames: dict[str, dict[str, Any]],
    *,
    timeout_s: float = 10.0,
    memory_mb: int = 512,
    max_output: int = 8_000,
) -> SandboxResult:
    try:
        check_code(code)
    except PolicyError as exc:
        return SandboxResult(ok=False, error=f"blocked by sandbox policy: {exc}")

    prefix, label = isolation_prefix()
    if prefix is None:
        return SandboxResult(ok=False, error=f"run_python is disabled: {label}")

    payload = json.dumps(
        {"code": code, "frames": frames, "memory_mb": memory_mb, "max_output": max_output},
        default=str,
    )
    workdir = tempfile.mkdtemp(prefix="quarry-py-")
    env = child_env(workdir)
    cmd = [*prefix, sys.executable, "-I", "-B", str(RUNNER)]
    start = time.perf_counter()
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=workdir,
        env=env,
        preexec_fn=lambda: _limits(int(timeout_s) + 1, memory_mb),
    )
    try:
        out, err = proc.communicate(payload.encode(), timeout=timeout_s)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        return SandboxResult(ok=False, error=f"time limit of {timeout_s:.0f}s exceeded")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    elapsed = (time.perf_counter() - start) * 1000

    try:
        data = json.loads(out.decode() or "{}")
    except json.JSONDecodeError:
        data = {}
    if not data:
        reason = "process was killed"
        if proc.returncode in (-signal.SIGXCPU, -signal.SIGKILL):
            reason = "CPU time limit exceeded"
        elif proc.returncode == -signal.SIGSEGV or b"MemoryError" in err:
            reason = "memory limit exceeded"
        tail = err.decode(errors="replace").strip().splitlines()[-1:] or [""]
        return SandboxResult(ok=False, error=f"{reason} ({tail[0][:200]})", elapsed_ms=elapsed)
    return SandboxResult(
        ok=bool(data.get("ok")),
        stdout=data.get("stdout", ""),
        columns=data.get("columns", []),
        rows=data.get("rows", []),
        error=data.get("error"),
        elapsed_ms=elapsed,
    )
