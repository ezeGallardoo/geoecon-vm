from __future__ import annotations

import re

# (clave OSM, valor) -> rubro interno. Lo que no matchea cae en "otro".
OSM_RULES: dict[tuple[str, str], str] = {
    ("shop", "kiosk"): "kiosco",
    ("shop", "newsagent"): "kiosco",
    ("shop", "convenience"): "despensa",
    ("shop", "supermarket"): "supermercado",
    ("shop", "grocery"): "almacen",
    ("shop", "general"): "almacen",
    ("amenity", "pharmacy"): "farmacia",
    ("shop", "chemist"): "farmacia",
    ("shop", "hardware"): "ferreteria",
    ("shop", "doityourself"): "corralon",
    ("shop", "trade"): "corralon",
    ("shop", "bakery"): "panaderia",
    ("shop", "butcher"): "carniceria",
    ("shop", "greengrocer"): "verduleria",
    ("amenity", "restaurant"): "restaurante",
    ("amenity", "fast_food"): "restaurante",
    ("amenity", "cafe"): "cafeteria",
    ("amenity", "ice_cream"): "heladeria",
    ("shop", "ice_cream"): "heladeria",
    ("shop", "clothes"): "indumentaria",
    ("shop", "shoes"): "calzado",
    ("amenity", "fuel"): "estacion_servicio",
    ("shop", "tyres"): "gomeria",
    ("shop", "car_repair"): "taller_mecanico",
    ("amenity", "car_repair"): "taller_mecanico",
    ("shop", "hairdresser"): "peluqueria",
    ("shop", "beauty"): "peluqueria",
    ("leisure", "fitness_centre"): "gimnasio",
    ("amenity", "veterinary"): "veterinaria",
    ("shop", "books"): "libreria",
    ("shop", "car_parts"): "casa_de_repuestos",
    ("shop", "wholesale"): "distribuidora",
    ("building", "industrial"): "industria",
    ("building", "warehouse"): "galpon",
    ("amenity", "school"): "institucion",
    ("amenity", "hospital"): "institucion",
    ("amenity", "clinic"): "institucion",
    ("amenity", "bank"): "institucion",
    ("office", "government"): "institucion",
}


def category_from_tags(tags: dict[str, str]) -> str | None:
    for key in ("shop", "amenity", "leisure", "office", "building"):
        value = tags.get(key)
        if not value:
            continue
        mapped = OSM_RULES.get((key, value))
        if mapped:
            return mapped
        if key in ("shop", "amenity"):
            return "otro"
    return None


def subcategories_from_tags(tags: dict[str, str]) -> list[str]:
    found: list[str] = []
    for key in ("shop", "amenity", "cuisine", "leisure", "office", "building"):
        value = tags.get(key)
        if value and value not in found:
            found.append(value)
    return found


_DAY_SPAN = {
    "mo-fr": 5,
    "mo-sa": 6,
    "mo-su": 7,
    "mon-fri": 5,
    "mon-sat": 6,
    "mon-sun": 7,
}


def weekly_hours_from_osm(opening_hours: str | None) -> int | None:
    """Lee los casos simples de opening_hours. Si el patrón no es claro, devuelve None."""
    if not opening_hours:
        return None
    text = opening_hours.strip().lower()
    if text in {"24/7", "24/7 open"}:
        return 168
    match = re.fullmatch(
        r"(mo-fr|mo-sa|mo-su|mon-fri|mon-sat|mon-sun)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})",
        text,
    )
    if not match:
        return None
    days = _DAY_SPAN[match.group(1)]
    start = int(match.group(2)) * 60 + int(match.group(3))
    end = int(match.group(4)) * 60 + int(match.group(5))
    if end <= start:
        return None
    return int(round(days * (end - start) / 60))


def cuit_is_valid(cuit: str) -> bool:
    digits = re.sub(r"\D", "", cuit)
    if len(digits) != 11:
        return False
    weights = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    total = sum(int(digit) * weight for digit, weight in zip(digits[:10], weights))
    difference = 11 - (total % 11)
    if difference == 11:
        check = 0
    elif difference == 10:
        check = 9
    else:
        check = difference
    return check == int(digits[10])


def format_cuit(cuit: str) -> str:
    digits = re.sub(r"\D", "", cuit)
    return f"{digits[:2]}-{digits[2:10]}-{digits[10]}"
