from __future__ import annotations

import httpx

from geoecon.categories import cuit_is_valid, format_cuit
from geoecon.config import Settings


def fetch_deudas(settings: Settings, cuit: str) -> dict:
    if not cuit_is_valid(cuit):
        raise ValueError(f"CUIT inválido: {cuit}")
    digits = format_cuit(cuit).replace("-", "")
    url = settings.bcra_deudas_url.format(cuit=digits)
    response = httpx.get(
        url,
        timeout=30,
        headers={"User-Agent": "GeoEconVM/2.0 (uso interno Villa Maria)"},
    )
    if response.status_code == 404:
        return {"identificacion": digits, "periodos": [], "denominacion": None}
    response.raise_for_status()
    body = response.json()
    return body.get("results") or body


def summarize_deudas(results: dict) -> dict:
    """La API informa el monto en miles de pesos. Se guarda también el equivalente en pesos."""
    periods = results.get("periodos") or []
    if not periods:
        return {
            "legal_name": results.get("denominacion"),
            "bcra_entities": [],
            "bcra_worst_status": None,
            "bcra_debt_thousands": 0,
            "bcra_total_debt_ars": 0,
        }
    latest = max(periods, key=lambda period: str(period.get("periodo") or ""))
    entities = latest.get("entidades") or []
    names = []
    worst = None
    thousands = 0.0
    for entity in entities:
        name = entity.get("entidad")
        if name:
            names.append(name)
        situation = entity.get("situacion")
        if situation is not None:
            worst = situation if worst is None else max(worst, int(situation))
        amount = entity.get("monto") or 0
        thousands += float(amount)
    return {
        "legal_name": results.get("denominacion"),
        "bcra_entities": names,
        "bcra_worst_status": worst,
        "bcra_debt_thousands": round(thousands, 2),
        "bcra_total_debt_ars": round(thousands * 1000, 2),
    }


def apply_bcra(conn, settings: Settings, cuit: str) -> int:
    summary = summarize_deudas(fetch_deudas(settings, cuit))
    formatted = format_cuit(cuit)
    cursor = conn.execute(
        """
        UPDATE businesses
        SET legal_name = COALESCE(%s, legal_name),
            bcra_entities = %s,
            bcra_worst_status = %s,
            bcra_debt_thousands = %s,
            bcra_total_debt_ars = %s
        WHERE cuit = %s OR replace(cuit, '-', '') = %s
        """,
        (
            summary["legal_name"],
            summary["bcra_entities"],
            summary["bcra_worst_status"],
            summary["bcra_debt_thousands"],
            summary["bcra_total_debt_ars"],
            formatted,
            formatted.replace("-", ""),
        ),
    )
    conn.execute("SELECT recalculate_estimates()")
    conn.commit()
    return cursor.rowcount
