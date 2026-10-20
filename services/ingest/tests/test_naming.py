"""Helpers de texto de la ingesta. No dependen de red ni de geometría."""

from geoecon.naming import SMALL_WORDS, display_name, repair_text, zone_name


def test_zone_name_repairs_doubled_n():
    assert zone_name("Rural Intensiva de PequeÃ±a Escala") == "Rural Intensiva de Pequeña Escala"


def test_zone_name_keeps_alphanumeric_tokens():
    # "RN" y "N158" se conservan tal cual: son rutas, no palabras.
    assert zone_name("Circunvalacion y RN N158") == "Circunvalacion y RN N158"


def test_zone_name_lowercases_particles_after_first_word():
    assert zone_name("Central en Altura") == "Central en Altura"
    assert zone_name("Barrio La Merced") == "Barrio la Merced"


def test_zone_name_keeps_short_acronyms_only_in_uppercase():
    # "en" es partícula y va en minúscula; "Alta" no, porque no son todas mayúsculas.
    assert zone_name("Zona Rn Centro") == "Zona Rn Centro"


def test_zone_name_of_empty_string():
    assert zone_name("") == ""


def test_display_name_fixes_the_belgrano_typo():
    # El shapefile municipal trae BELGARANO con G.
    assert display_name("BELGARANO") == "Belgrano"


def test_display_name_lowercases_particles():
    assert display_name("BARRIO DE LAS ROSAS") == "Barrio de las Rosas"


def test_display_name_trims_nothing_extra():
    assert display_name("Centro") == "Centro"


# El shapefile municipal sale con BOM de archivo UTF-8 y el caracter entraba
# al nombre. No rompía nada, así que pasaba desapercibido: quedaba un glifo
# invisible pegado a neighborhoods.name.
def test_display_name_strips_leading_bom():
    assert display_name("\ufeffCENTRO") == "Centro"


def test_zone_name_strips_leading_bom():
    assert zone_name("\ufeffBarrio La Merced") == "Barrio la Merced"


def test_bom_inside_the_name_is_left_alone():
    # Un BOM en el medio no es marca de archivo: es un dato roto. Si se borra,
    # el nombre corrupto entra sin dejar rastro y no se puede diagnosticar.
    assert display_name("CEN\ufeffTRO") == "Cen\ufefftro"


# _barrio_id normaliza el BOM a ascii/ignore, así que el id colisionaba con el
# del nombre limpio mientras el name quedaba distinto. Deduplicaba una mitad
# de la fila y no la otra.
# El id se reconstruye acá en vez de importar geoecon.barrios: ese módulo
# arrastra httpx, shapefile, pyproj y shapely, y este test no los necesita.
def test_bom_does_not_collide_with_clean_name():
    import re
    import unicodedata

    def barrio_id(name: str) -> str:
        ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
        slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
        return f"barrio:{slug}"

    assert barrio_id(display_name("\ufeffCENTRO")) == barrio_id("Centro")


# El typo municipal estaba arreglado solo en display_name. zone_name lo dejaba
# pasar, así que las zonas del WFS mostraban BELGARANO tal cual.
#
# Alcance: el BOM se limpia SOLO del arranque, que es donde lo pone utf-8-sig.
# Un BOM al final no está cubierto: no sabemos si es marca del archivo o dato
# roto, y borrarlo taparía corrupción real. Hace falta ver un registro del
# shapefile municipal para decidirlo.
def test_zone_name_fixes_the_belgrano_typo():
    assert zone_name("BELGARANO") == "Belgrano"
    assert zone_name("\ufeffBELGARANO") == "Belgrano"


# Las dos funciones comparten pipeline, pero la conservación de siglas es una
# diferencia INTENCIONAL: zone_name viene del WFS y tiene que respetar RN o
# N158; display_name viene del shapefile municipal y no las necesita.
def test_zone_name_keeps_acronyms_where_display_name_does_not():
    assert zone_name("Zona RN 158") == "Zona RN 158"
    assert display_name("Zona RN 158") == "Zona Rn 158"


def test_display_and_zone_name_agree_when_no_acronyms_are_involved():
    for raw in ("CENTRO", "Barrio La Merced", "BELGARANO", "PequeÃ±a Escala"):
        assert display_name(raw) == zone_name(raw)


def test_repair_text_undoes_cp1252():
    assert repair_text("PequeÃ±a") == "Pequeña"
    assert repair_text("Ya normal") == "Ya normal"


def test_small_words_are_particles_not_content():
    # Si esto cambia, el título casing de barrios y zonas se rompe en silencio.
    assert SMALL_WORDS == {"de", "del", "en", "la", "las", "los", "y"}