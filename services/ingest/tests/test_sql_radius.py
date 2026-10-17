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


class TestLandValueWeighting:
    """REGRESIÓN: el VUT se pondera por área, no con un AVG plano."""

    def _two_barrios(self, seed, square):
        """Barrio barato que domina el círculo, barrio caro en una franja angosta."""
        seed_zone, seed_barrio, _ = seed
        seed_barrio("test:suelo:barato", square(CENTER_LNG, CENTER_LAT, 0.002), 100000)
        seed_barrio("test:suelo:caro", square(CENTER_LNG + 0.002, CENTER_LAT, 0.0005), 400000)

    def test_weighted_by_area_not_averaged(self, conn, seed, square, radius_report):
        self._two_barrios(seed, square)

        report = radius_report(CENTER_LAT, CENTER_LNG, 300)
        land = report["landValueM2"]

        # El barrio barato cubre la mayor parte del círculo (~94% del área),
        # así que el ponderado tiene que quedar claramente cerca de 100000.
        # El AVG plano de los dos valores da 250000.
        flat_average = 250000
        assert abs(land - flat_average) > 50000, (
            f"el VUT salió {land}, sospechosamente cerca del promedio plano "
            f"({flat_average}). Parece que no se está ponderando por área."
        )
        assert abs(land - 100000) < abs(land - 400000), (
            f"el VUT ponderado {land} debería estar más cerca del barrio que "
            f"domina el área (100000) que del caro (400000)."
        )

    def test_barrio_with_zero_land_value_is_excluded(self, conn, seed, square, radius_report):
        """Un barrio con VUT 0 no debe arrastrar el promedio ni el denominador."""
        seed_zone, seed_barrio, _ = seed
        seed_barrio("test:suelo:real", square(CENTER_LNG, CENTER_LAT, 0.002), 100000)
        seed_barrio("test:suelo:cero", square(CENTER_LNG + 0.002, CENTER_LAT, 0.0005), 0)

        report = radius_report(CENTER_LAT, CENTER_LNG, 300)
        land = report["landValueM2"]

        # Si el cero entrara en el denominador, el resultado caería muy por
        # debajo de 100000 aunque el único valor válido sea ese.
        assert 95000 <= land <= 105000, f"el barrio con VUT 0 contaminó el promedio: {land}"

    def test_null_land_value_is_excluded(self, conn, seed, square, radius_report):
        seed_zone, seed_barrio, _ = seed
        seed_barrio("test:suelo:ok", square(CENTER_LNG, CENTER_LAT, 0.002), 100000)
        seed_barrio("test:suelo:nulo", square(CENTER_LNG + 0.002, CENTER_LAT, 0.0005), None)

        report = radius_report(CENTER_LAT, CENTER_LNG, 300)
        assert report["landValueM2"] is not None
        assert 95000 <= report["landValueM2"] <= 105000

    def test_circle_without_land_value_returns_null(self, conn, seed, square, radius_report):
        seed_zone, _, _ = seed
        seed_zone("test:suelo:solazone", square(CENTER_LNG, CENTER_LAT, 0.002), 500)

        report = radius_report(CENTER_LAT, CENTER_LNG, 100)
        assert report["landValueM2"] is None