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


def test_repair_text_undoes_cp1252():
    assert repair_text("PequeÃ±a") == "Pequeña"
    assert repair_text("Ya normal") == "Ya normal"


def test_small_words_are_particles_not_content():
    # Si esto cambia, el título casing de barrios y zonas se rompe en silencio.
    assert SMALL_WORDS == {"de", "del", "en", "la", "las", "los", "y"}