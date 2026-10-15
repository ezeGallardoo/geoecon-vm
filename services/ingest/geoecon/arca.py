from __future__ import annotations

import csv
from pathlib import Path

from psycopg.types.json import Json

from geoecon.categories import cuit_is_valid, format_cuit


def link_csv(conn, path: Path) -> tuple[int, int]:
    """Cruza un padrón local (CSV) con los comercios ya cargados.

    Columnas: cuit, legal_name, tax_regime, activity_code_clae, activity_started_on.
    La clave de match es place_id o, si no está, el nombre comercial (`name`).
    No consulta el sitio de ARCA: la constancia pública pide captcha.
    """
    linked = 0
    skipped = 0
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            cuit = (row.get("cuit") or "").strip()
            if cuit and not cuit_is_valid(cuit):
                skipped += 1
                continue
            payload = {
                "place_id": (row.get("place_id") or "").strip(),
                "name": (row.get("name") or "").strip(),
                "cuit": format_cuit(cuit) if cuit else "",
                "legal_name": (row.get("legal_name") or "").strip(),
                "tax_regime": (row.get("tax_regime") or "").strip(),
                "activity_code_clae": (row.get("activity_code_clae") or "").strip(),
                "activity_started_on": (row.get("activity_started_on") or "").strip(),
            }
            found = conn.execute("SELECT link_fiscal(%s::jsonb) AS id", (Json(payload),)).fetchone()
            if found and found["id"]:
                linked += 1
            else:
                skipped += 1
    conn.execute("SELECT recalculate_estimates()")
    conn.commit()
    return linked, skipped
