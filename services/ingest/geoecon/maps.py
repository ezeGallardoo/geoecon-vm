from __future__ import annotations

import random
import re
import time
from urllib.parse import quote

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
]


def _place_from_url(url: str) -> dict | None:
    """Lee coordenadas y place_id del URL de la ficha. Sin coordenadas no se guarda nada."""
    point = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", url)
    data_point = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", url)
    if data_point:
        lat, lng = float(data_point.group(1)), float(data_point.group(2))
    elif point:
        lat, lng = float(point.group(1)), float(point.group(2))
    else:
        return None
    place = re.search(r"!1s([^!]+)", url)
    place_id = place.group(1) if place else f"gmaps:@{lat:.6f},{lng:.6f}"
    return {"lat": lat, "lng": lng, "place_id": place_id[:128]}


def _pause() -> None:
    time.sleep(random.uniform(2.0, 5.5))


def scrape_category(conn, category: str, limit: int | None = None) -> int:
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
                articles = page.locator('[role="article"]')
                count = min(articles.count(), 20)
                for index in range(count):
                    article = articles.nth(index)
                    label = article.get_attribute("aria-label") or ""
                    if not label:
                        continue
                    article.click(timeout=8000)
                    page.wait_for_timeout(1200)
                    parsed = _place_from_url(page.url)
                    if parsed is None:
                        continue
                    from geoecon.db import upsert

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
