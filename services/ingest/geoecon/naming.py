from __future__ import annotations

# Helpers de texto sin dependencias de red ni geo. Viven aparte de `barrios`
# para que se puedan testear sin instalar httpx, shapefile, pyproj ni shapely:
# `selftest` los importa y antes arrastraba toda la cadena de ingesta.

SMALL_WORDS = {"de", "del", "en", "la", "las", "los", "y"}


def repair_text(raw: str) -> str:
    """Revierte el doble encoding cp1252 de los shapefiles municipales."""
    try:
        return raw.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return raw


def display_name(raw: str) -> str:
    """Nombre de barrio legible desde el shapefile de la Municipalidad."""
    raw = repair_text(raw).replace("BELGARANO", "BELGRANO")
    words = raw.split()
    out = []
    for index, word in enumerate(words):
        lower = word.lower()
        out.append(lower if index > 0 and lower in SMALL_WORDS else lower.capitalize())
    return " ".join(out)


def zone_name(raw: str) -> str:
    """Nombre legible de una zona WFS. Repara la ñ doble-codificada y conserva RN o N158."""
    try:
        repaired = raw.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        repaired = raw
    words = repaired.split()
    out = []
    for index, word in enumerate(words):
        if any(char.isdigit() for char in word) or (word.isupper() and len(word) <= 3):
            out.append(word)
            continue
        lower = word.lower()
        out.append(lower if index > 0 and lower in SMALL_WORDS else lower.capitalize())
    return " ".join(out)