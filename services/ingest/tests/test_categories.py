"""Clasificación de rubros y validación de CUIT."""

from geoecon.categories import (
    OSM_RULES,
    category_from_tags,
    cuit_is_valid,
    format_cuit,
    subcategories_from_tags,
    weekly_hours_from_osm,
)


def _sample_cuit() -> str:
    body = "2012345678"
    weights = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    total = sum(int(digit) * weight for digit, weight in zip(body, weights))
    difference = 11 - (total % 11)
    check = 0 if difference == 11 else 9 if difference == 10 else difference
    return f"20-12345678-{check}"


class TestWeeklyHours:
    def test_24_7_is_the_whole_week(self):
        assert weekly_hours_from_osm("24/7") == 168
        assert weekly_hours_from_osm("24/7 open") == 168

    def test_weekday_range(self):
        # 9 h por día × 5 días.
        assert weekly_hours_from_osm("Mo-Fr 09:00-18:00") == 45

    def test_saturday_range(self):
        assert weekly_hours_from_osm("Mo-Sa 09:00-18:00") == 54

    def test_unparseable_returns_none_rather_than_guessing(self):
        # Preferimos no tener dato antes que inventar horas: las horas entran
        # directo en la estimación de tráfico.
        assert weekly_hours_from_osm("horario raro") is None
        assert weekly_hours_from_osm("Mo-Fr 09:00-18:00; Sa 09:00-13:00") is None
        assert weekly_hours_from_osm("") is None
        assert weekly_hours_from_osm(None) is None

    def test_end_before_start_returns_none(self):
        assert weekly_hours_from_osm("Mo-Fr 09:00-09:00") is None


class TestCuit:
    def test_accepts_a_valid_cuit(self):
        assert cuit_is_valid(_sample_cuit())

    def test_rejects_wrong_check_digit(self):
        assert cuit_is_valid("20-00000000-0") is False

    def test_rejects_wrong_length(self):
        assert cuit_is_valid("2012345678") is False

    def test_tolerates_missing_dashes(self):
        assert cuit_is_valid(_sample_cuit().replace("-", "")) is True

    def test_format_cuit_groups_digits(self):
        assert format_cuit("20123456780") == "20-12345678-0"


class TestCategoryMapping:
    def test_known_shop_tag_maps_to_internal_category(self):
        assert category_from_tags({"shop": "bakery"}) == "panaderia"
        assert category_from_tags({"amenity": "pharmacy"}) == "farmacia"

    def test_precedence_follows_the_key_order(self):
        # "shop" gana sobre "amenity" porque se busca primero.
        assert category_from_tags({"amenity": "cafe", "shop": "bakery"}) == "panaderia"

    def test_known_amenity_value_not_in_rules_falls_to_otro(self):
        assert category_from_tags({"amenity": "bar"}) == "otro"

    def test_unknown_key_returns_none(self):
        # None significa "no es un comercio", distinto de "otro".
        assert category_from_tags({"name": "Solo un nombre"}) is None
        assert category_from_tags({}) is None

    def test_otro_is_only_a_fallback_never_a_rule_target(self):
        # "otro" no está en OSM_RULES: lo devuelve category_from_tags cuando la
        # etiqueta es shop/amenity desconocida. Si alguien lo agrega como destino
        # de una regla, la reclassificación deja de tener a dónde escapar.
        assert "otro" not in OSM_RULES.values()
        assert category_from_tags({"shop": "cosas_raras"}) == "otro"
        assert category_from_tags({"building": "cosas_raras"}) is None

    def test_subcategories_collect_the_raw_tags(self):
        found = subcategories_from_tags({"shop": "bakery", "cuisine": "es"})
        assert "bakery" in found
        assert "es" in found