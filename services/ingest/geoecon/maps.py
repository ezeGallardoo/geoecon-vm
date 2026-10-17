from __future__ import annotations

import math
import random
import re
import time
from urllib.parse import quote

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
]


def _place_from_href(href: str) -> dict | None:
    """Lee place_id y coordenadas del href de la ficha.

    Se lee del href del ancla del listado y NO de la URL después de clickear. Al
    clickear, Google reescribe la URL y el `!1s` pasa a contener la consulta de
    búsqueda en vez del identificador del lugar, y el `@lat,lng` del path sale
    con una longitud corrida. El href del listado sí trae los tres correctos.

    Sin coordenadas no se guarda nada.
    """
    lat = re.search(r"!3d(-?\d+\.\d+)", href)
    lng = re.search(r"!4d(-?\d+\.\d+)", href)
    if not lat or not lng:
        return None
    place = re.search(r"!1s([^!/]+)", href)
    place_id = place.group(1) if place else f"gmaps:@{lat.group(1)},{lng.group(1)}"
    return {
        "lat": float(lat.group(1)),
        "lng": float(lng.group(1)),
        "place_id": place_id[:128],
    }


def _meters_between(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia plana aproximada. Alcanza para descartar lugares lejanos."""
    north = (lat1 - lat2) * 110540.0
    east = (lng1 - lng2) * 111320.0 * math.cos(math.radians(lat1))
    return math.hypot(north, east)


def _pause() -> None:
    time.sleep(random.uniform(2.0, 5.5))


def scrape_category(conn, category: str, limit: int | None = None, radius_m: float = 900.0) -> int:
    """Barrido de Google Maps por celda, con reanudación (RNF-02).

    Los selectores del listado cambian seguido. Si el feed no aparece, la celda
    queda en ERROR y el próximo arranque sigue por la siguiente pendiente.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise SystemExit(
            "Falta Playwright. En el entorno de ingesta: pip install playwright && playwright install chromium"
        ) from exc

    conn.execute("SELECT ensure_scrape_jobs(%s, %s)", ("google_maps", category))
    rows = conn.execute(
        """
        SELECT j.job_id, g.cell_id, g.center_lat, g.center_lng
        FROM scrape_jobs j
        JOIN scrape_grid g ON g.cell_id = j.cell_id
        WHERE j.source = 'google_maps'
          AND j.query = %s
          AND j.status <> 'COMPLETED'
        ORDER BY g.cell_id
        """,
        (category,),
    ).fetchall()
    if limit is not None:
        rows = rows[:limit]

    written = 0
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for row in rows:
            context = browser.new_context(user_agent=random.choice(USER_AGENTS), locale="es-AR")
            page = context.new_page()
            url = (
                "https://www.google.com/maps/search/"
                f"{quote(category)}/@{row['center_lat']},{row['center_lng']},16z"
            )
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                _pause()
                feed = page.locator('[role="feed"]')
                if feed.count() == 0:
                    raise RuntimeError("el listado de Maps no apareció")
                # Se leen los href del listado sin clickear. Clickear es lento
                # (alrededor de 1,2 s por ficha) y sobre todo rompe la URL:
                # Google reescribe el `!1s` con la consulta de búsqueda y corre
                # la longitud del path. El href del ancla ya trae place_id y
                # coordenadas exactos.
                anchors = page.locator('a[href*="/maps/place/"]')
                count = min(anchors.count(), 20)
                for index in range(count):
                    anchor = anchors.nth(index)
                    href = anchor.get_attribute("href") or ""
                    label = (anchor.get_attribute("aria-label") or "").strip()
                    if not href or not label:
                        continue
                    parsed = _place_from_href(href)
                    if parsed is None:
                        continue
                    # Maps devuelve resultados de todo el país si la búsqueda no
                    # encuentra suficiente cerca. Se descarta lo que está fuera
                    # del radio de la celda: son de otra ciudad.
                    if _meters_between(parsed["lat"], parsed["lng"], row["center_lat"], row["center_lng"]) > radius_m:
                        continue
                    from geoecon.db import upsert

                    try:
                        with conn.transaction():
                            upsert(
                                conn,
                                {
                                    "place_id": parsed["place_id"],
                                    "name": label[:255],
                                    "category": category,
                                    "lng": parsed["lng"],
                                    "lat": parsed["lat"],
                                    "source": "google_maps",
                                    "attributes": {"maps_label": label, "cell_id": row["cell_id"]},
                                },
                            )
                    except Exception:
                        # Un punto fuera del bbox de Villa María hace fallar
                        # upsert_business. No debe tumbar la celda entera.
                        continue
                    written += 1
                conn.execute(
                    """
                    UPDATE scrape_jobs
                    SET status = 'COMPLETED', scanned_at = NOW(), last_error = NULL
                    WHERE job_id = %s
                    """,
                    (row["job_id"],),
                )
                conn.execute(
                    """
                    UPDATE scrape_grid
                    SET status = 'COMPLETED', last_scanned_at = NOW()
                    WHERE cell_id = %s
                    """,
                    (row["cell_id"],),
                )
                conn.commit()
            except Exception as exc:
                conn.rollback()
                conn.execute(
                    """
                    UPDATE scrape_jobs
                    SET status = 'ERROR', last_error = %s, scanned_at = NOW()
                    WHERE job_id = %s
                    """,
                    (str(exc)[:500], row["job_id"]),
                )
                conn.execute(
                    "UPDATE scrape_grid SET status = 'ERROR', last_scanned_at = NOW() WHERE cell_id = %s",
                    (row["cell_id"],),
                )
                conn.commit()
            finally:
                context.close()
                _pause()
        browser.close()
    conn.execute("SELECT recalculate_estimates()")
    conn.commit()
    return written
