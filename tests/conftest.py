from __future__ import annotations

from collections.abc import Iterator

import pytest

from quarry.config import Settings, get_settings
from quarry.tools.base import RunContext
from quarry.tools.db import Database


@pytest.fixture(scope="session")
def settings() -> Settings:
    return get_settings().model_copy(update={"sql_timeout_s": 5.0})


@pytest.fixture(scope="session")
def db(settings: Settings) -> Database:
    if not settings.db_path.exists():
        pytest.skip("warehouse not built; run `make data`")
    return Database(settings.db_path)


@pytest.fixture
def ctx(db: Database, settings: Settings) -> Iterator[RunContext]:
    c = RunContext(db=db, settings=settings)
    yield c
    c.close()
