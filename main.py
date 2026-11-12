"""Vercel entrypoint. Vercel looks for a FastAPI instance named `app` in main.py.

Locally, run `make serve` instead; this file only makes the src/ layout importable on
platforms that do not install the project package.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from quarry.api.app import app

__all__ = ["app"]
