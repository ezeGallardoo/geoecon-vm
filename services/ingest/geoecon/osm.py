from __future__ import annotations

import httpx

from geoecon.categories import category_from_tags, subcategories_from_tags, weekly_hours_from_osm
from geoecon.config import Settings
from geoecon.db import upsert


_FILTERS = (
    'node["shop"]',
    'node["amenity"~"restaurant|cafe|fast_food|pharmacy|fuel|bank|veterinary|school|hospital|clinic|ice_cream|car_repair"]',
    'node["leisure"="fitness_centre"]',
    'way["shop"]',
    'way["amenity"~"restaurant|cafe|fast_food|pharmacy|fuel|bank|veterinary|school|hospital|clinic|ice_cream|car_repair"]',
    'way["building"~"industrial|warehouse"]',
    'way["leisure"="fitness_centre"]',
)


def _query(settings: Settings, selector: str) -> str:
    south, west, north, east = settings.south, settings.west, settings.north, settings.east
    box = f"{south},{west},{north},{east}"
    return f"[out:json][timeout:60];{selector}({box});out center tags;"


def _mirrors(settings: Settings) -> list[str]:
    mirrors = [
        settings.overpass_url,
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.openstreetmap.fr/api/interpreter",
    ]
    unique: list[str] = []
    for mirror in mirrors:
        if mirror not in unique:
            unique.append(mirror)
    return unique


def _fetch(settings: Settings, selector: str) -> list[dict]:
    query = _query(settings, selector)
    last_error: Exception | None = None
    for mirror in _mirrors(settings):
        try:
            response = httpx.post(
                mirror,
                data={"data": query},
                timeout=90,
                headers={"User-Agent": "GeoEconVM/2.0 (uso interno Villa Maria)"},
            )
            response.raise_for_status()
            return response.json().get("elements", [])
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
    if last_error:
        raise last_error
    return []


def import_osm(conn, settings: Settings) -> int:
    elements: list[dict] = []
    seen: set[str] = set()
    for selector in _FILTERS:
        batch = _fetch(settings, selector)
        print(f"{selector}: {len(batch)}", flush=True)
        for element in batch:
            key = f"{element.get('type')}:{element.get('id')}"
            if key in seen:
                continue
            seen.add(key)
            elements.append(element)
    written = 0
    warned = False
    for element in elements:
        tags = element.get("tags") or {}
        category = category_from_tags(tags)
        name = tags.get("name")
        if not category or not name:
            continue
        lat = element.get("lat") or (element.get("center") or {}).get("lat")
        lng = element.get("lon") or (element.get("center") or {}).get("lon")
        if lat is None or lng is None:
            continue
        opening = tags.get("opening_hours")
        payload = {
            "place_id": f"osm:{element.get('type')}:{element.get('id')}",
            "name": name[:255],
            "category": category,
            "subcategories": subcategories_from_tags(tags),
            "address": _address(tags),
            "phone": tags.get("phone") or tags.get("contact:phone"),
            "website": tags.get("website") or tags.get("contact:website"),
            "lng": lng,
            "lat": lat,
            "source": "osm",
            "opening_hours": opening,
            "weekly_open_hours": weekly_hours_from_osm(opening),
            "attributes": {"osm": tags},
        }
        try:
            with conn.transaction():
                upsert(conn, payload)
            written += 1
        except Exception as exc:
            if not warned:
                print(f"primer descarte: {exc}", flush=True)
                warned = True
            continue
    conn.execute("SELECT recalculate_estimates()")
    conn.commit()
    return written


def _address(tags: dict) -> str | None:
    street = tags.get("addr:street")
    number = tags.get("addr:housenumber")
    if street and number:
        return f"{street} {number}"[:255]
    if street:
        return street[:255]
    return None
