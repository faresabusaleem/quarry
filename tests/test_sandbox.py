import sys

import pytest

from quarry.sandbox.executor import isolation_prefix, run_python
from quarry.sandbox.policy import PolicyError, check_code

FRAMES = {
    "df_q1": {
        "columns": ["month", "revenue"],
        "rows": [["2018-01", 100.0], ["2018-02", 150.0], ["2018-03", 120.0]],
    }
}

needs_isolation = pytest.mark.skipif(
    isolation_prefix()[0] is None, reason="no OS-level sandbox on this host"
)


@pytest.mark.parametrize(
    "code",
    [
        "import os",
        "import subprocess",
        "from socket import socket",
        "import pandas.io.common",  # banned attr path via import is fine, but 'io' attr below
        "open('/etc/passwd').read()",
        "eval('1+1')",
        "__import__('os')",
        "(1).__class__.__bases__",
        "pd.read_csv('/etc/passwd')",
        "df_q1.to_csv('/tmp/x.csv')",
        "np.load('x.npy', allow_pickle=True)",
        "getattr(pd, 'io')",
        "pd.io.common.os.system('ls')",
        "df_q1.query('revenue > 1')",
    ],
)
def test_policy_rejects_escape_attempts(code: str) -> None:
    if code == "import pandas.io.common":
        check_code(code)  # importing allowed packages is fine; attribute paths are what we guard
        return
    with pytest.raises(PolicyError):
        check_code(code)


def test_policy_allows_normal_analysis() -> None:
    check_code(
        "import numpy as np\nfrom scipy import stats\n"
        "r = stats.pearsonr(df_q1['revenue'], np.arange(len(df_q1)))\n"
        "result = df_q1.assign(growth=df_q1['revenue'].pct_change()).to_dict()\n"
    )


@needs_isolation
def test_runs_pandas_and_returns_result() -> None:
    res = run_python(
        "result = df_q1.assign(growth=df_q1['revenue'].pct_change().round(4))\nprint('ok')",
        FRAMES,
    )
    assert res.ok, res.error
    assert res.columns == ["month", "revenue", "growth"]
    assert res.rows[1][2] == 0.5
    assert "ok" in res.stdout


@needs_isolation
def test_scalar_result() -> None:
    res = run_python(
        "from scipy import stats\nresult = float(stats.tmean(df_q1['revenue']))", FRAMES
    )
    assert res.ok, res.error
    assert res.rows == [[pytest.approx(123.333, rel=1e-3)]]


@needs_isolation
def test_wall_clock_timeout() -> None:
    res = run_python("x = 0\nwhile True:\n    x += 1", {}, timeout_s=2)
    assert not res.ok
    assert "limit" in (res.error or "")


@needs_isolation
def test_memory_limit() -> None:
    res = run_python("big = np.ones((400, 1024, 1024))", {}, memory_mb=256, timeout_s=8)
    assert not res.ok
    assert "memory" in (res.error or "").lower()


@needs_isolation
def test_runtime_import_hook_blocks_dynamic_imports() -> None:
    # Even if code slipped past the static policy, the child refuses non-allow-listed imports.
    res = run_python("import importlib", {})
    assert not res.ok


@needs_isolation
def test_os_isolation_blocks_network_and_writes_even_without_python_guards() -> None:
    # Bypass the in-process guards entirely by running raw Python under the same prefix:
    # the OS layer alone must stop network access and file writes.
    import subprocess

    prefix, _ = isolation_prefix()
    probe = (
        "import socket\n"
        "try:\n"
        "    socket.create_connection(('1.1.1.1', 80), timeout=3); print('NET_OK')\n"
        "except OSError: print('NET_BLOCKED')\n"
        "try:\n"
        "    open('/tmp/quarry_sandbox_probe', 'w').write('x'); print('WRITE_OK')\n"
        "except OSError: print('WRITE_BLOCKED')\n"
    )
    out = subprocess.run(
        [*prefix, sys.executable, "-I", "-c", probe], capture_output=True, text=True, timeout=20
    ).stdout
    assert "NET_BLOCKED" in out
    if sys.platform == "darwin":
        assert "WRITE_BLOCKED" in out


def test_child_environment_has_no_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    from quarry.sandbox.executor import child_env

    monkeypatch.setenv("GEMINI_API_KEY", "secret-should-not-leak")
    env = child_env("/tmp/work")
    assert "GEMINI_API_KEY" not in env
    assert set(env) == {
        "PATH",
        "HOME",
        "LANG",
        "OPENBLAS_NUM_THREADS",
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
    }
