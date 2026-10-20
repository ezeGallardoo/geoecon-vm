from __future__ import annotations

# Helpers de texto sin dependencias de red ni geo. Viven aparte de `barrios`
# para que se puedan testear sin instalar httpx, shapefile, pyproj ni shapely:
# `selftest` los importa y antes arrastraba toda la cadena de ingesta.

SMALL_WORDS = {"de", "del", "en", "la", "las", "los", "y"}

# El shapefile municipal trae BELGARANO con G. El typo estaba arreglado en
# display_name pero no en zone_name, así que vivía en una sola de las dos
# funciones que hacen el mismo trabajo.
TYPO_FIXES = (("BELGARANO", "BELGRANO"),)


def _strip_bom(raw: str) -> str:
    """Saca el BOM de archivo UTF-8 del arranque.

    Solo del principio: ahí es una marca del archivo y no del dato. Un BOM en
    el medio es corrupción y se deja visible, porque borrarlo esconde el
    problema justo cuando hace falta diagnosticarlo.
    """
    return raw.lstrip("\ufeff")


def _apply_typos(raw: str) -> str:
    for wrong, right in TYPO_FIXES:
        raw = raw.replace(wrong, right)
    return raw


def repair_text(raw: str) -> str:
    """Revierte el doble encoding cp1252 de los shapefiles municipales."""
    try:
        return raw.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return raw


def _titlecase(raw: str, keep_acronyms: bool) -> str:
    """Título casing compartido. Las partículas van en minúscula salvo al inicio."""
    out = []
    for index, word in enumerate(raw.split()):
        if keep_acronyms and (any(char.isdigit() for char in word) or (word.isupper() and len(word) <= 3)):
            out.append(word)
            continue
        lower = word.lower()
        out.append(lower if index > 0 and lower in SMALL_WORDS else lower.capitalize())
    return " ".join(out)


def display_name(raw: str) -> str:
    """Nombre de barrio legible desde el shapefile de la Municipalidad."""
    return _titlecase(_apply_typos(repair_text(_strip_bom(raw))), keep_acronyms=False)


def zone_name(raw: str) -> str:
    """Nombre legible de una zona WFS. Repara la ñ doble-codificada y conserva RN o N158."""
    # El BOM va primero: \ufeff no existe en latin-1, así que si llega vivo al
    # encode la conversión revienta y el except devuelve el texto crudo, sin
    # reparar el encoding ni aplicar los typos.
    cleaned = _strip_bom(raw)
    try:
        repaired = cleaned.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        repaired = cleaned
    return _titlecase(_apply_typos(repaired), keep_acronyms=True)