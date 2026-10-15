from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

from geoecon.config import Settings, load_settings


@contextmanager
def connect(settings: Settings | None = None) -> Iterator[psycopg.Connection]:
    cfg = settings or load_settings()
    with psycopg.connect(cfg.database_url, row_factory=dict_row) as conn:
        yield conn


def upsert(conn: psycopg.Connection, payload: dict) -> str:
    from psycopg.types.json import Json

    row = conn.execute("SELECT upsert_business(%s::jsonb) AS id", (Json(payload),)).fetchone()
    if row is None:
        raise RuntimeError("upsert_business no devolvió id")
    return str(row["id"])
