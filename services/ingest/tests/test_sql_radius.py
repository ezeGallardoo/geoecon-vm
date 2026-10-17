"""radius_report: población, suelo y cobertura.

Estos tests fijan la diferencia entre "el círculo toca la zona" y "el círculo
cubre la zona". Antes de Task 3, `pop` sumaba la población completa de todo
radio que el círculo rozaba.
"""

import pytest

CENTER_LAT = -32.4103
CENTER_LNG = -63.2436


class TestPopulationProration:
    """REGRESIÓN: un círculo de 100 m no puede reportar un radio censal entero."""

    def test_small_circle_reports_a_fraction_not_the_whole_radio(
        self, conn, seed, square, radius_report
    ):
        seed_zone, _, _ = seed
        seed_zone("test:pop:unico", square(CENTER_LNG, CENTER_LAT, 0.002), 2000)

        report = radius_report(CENTER_LAT, CENTER_LNG, 100)
        population = report["populationIntersected"]

        assert population > 0, "el círculo está dentro del radio, debería haber habitantes"
        assert population < 2000, (
            f"el círculo de 100 m no puede cubrir un radio censal completo: "
            f"reportó {population} de 2000. Falta prorratear por área."
        )

    def test_large_circle_covering_the_whole_zone_reports_everything(
        self, conn, seed, square, radius_report
    ):
        seed_zone, _, _ = seed
        seed_zone("test:pop:completo", square(CENTER_LNG, CENTER_LAT, 0.002), 2000)

        report = radius_report(CENTER_LAT, CENTER_LNG, 2000)
        assert report["populationIntersected"] == 2000

    def test_proportional_to_radius(self, conn, seed, square, radius_report):
        """Doble radio, más o menos el doble de población."""
        seed_zone, _, _ = seed
        seed_zone("test:pop:prop", square(CENTER_LNG, CENTER_LAT, 0.02), 10000)

        small = radius_report(CENTER_LAT, CENTER_LNG, 100)["populationIntersected"]
        large = radius_report(CENTER_LAT, CENTER_LNG, 200)["populationIntersected"]

        assert large > small
        ratio = large / small if small else 0
        assert 2.5 < ratio < 5.5, f"el radio se duplicó pero la población salió ×{ratio:.2f}"

    def test_circle_missed_by_every_zone_is_zero(self, conn, seed, square, radius_report):
        seed_zone, _, _ = seed
        seed_zone("test:pop:lejos", square(CENTER_LNG + 0.05, CENTER_LAT, 0.001), 3000)

        report = radius_report(CENTER_LAT, CENTER_LNG, 100)
        assert report["populationIntersected"] == 0

    def test_degenerate_zone_does_not_break_the_function(
        self, conn, seed, radius_report
    ):
        """Un radio de área casi cero no puede dividir por cero."""
        seed_zone, _, _ = seed
        seed_zone(
            "test:pop:degenerado",
            {
                "type": "Polygon",
                "coordinates": [[[CENTER_LNG, CENTER_LAT], [CENTER_LNG, CENTER_LAT],
                                 [CENTER_LNG, CENTER_LAT], [CENTER_LNG, CENTER_LAT]]],
            },
            500,
        )

        report = radius_report(CENTER_LAT, CENTER_LNG, 100)
        assert report is not None
        assert report["populationIntersected"] >= 0