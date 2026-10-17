"""Modelo de gravedad de Huff: cuanta población le queda a cada comercio.

No es una medición de facturación. Es la población que el modelo le asigna a cada
local según distancia y competencia, multiplicada por el ticket del rubro. Sirve
para ordenar y comparar, no para declarar ingresos.

Huff (1964): P(i compra en j) = (A_j / d_ij^a) / SUM_k (A_k / d_ik^a)

Con A_j = 1 para todos (no tenemos superficie del local), la parte que importa
para el comercio j es:

    poblacion_capturada_j = SUM_i ( poblacion_i * w_ij / SUM_k w_ik )

donde w_ij = 1 / max(d_ij, d_min)^a. El termino SUM_k w_ik reparte la poblacion
de cada radio entre todos los comercios que compiten por ella: ese es el efecto
de competencia, y es lo que separa a Huff de unsimple radio circular.
"""

import pytest

CENTER_LNG = -63.2436
CENTER_LAT = -32.4103


@pytest.fixture
def catchment(conn):
    """Ejecuta assign_business_catchment() y devuelve los valores por place_id."""

    def _run() -> int:
        row = conn.execute("SELECT assign_business_catchment() AS n").fetchone()
        return int(row["n"])

    return _run


@pytest.fixture
def caught(conn):
    """(poblacion capturada, potencial) de un comercio por place_id."""

    def _of(place_id: str):
        row = conn.execute(
            """
            SELECT catchment_pop, captured_potential_ars
            FROM businesses WHERE place_id = %s
            """,
            (place_id,),
        ).fetchone()
        if row is None:
            return (None, None)
        return (
            None if row["catchment_pop"] is None else float(row["catchment_pop"]),
            None if row["captured_potential_ars"] is None
            else float(row["captured_potential_ars"]),
        )

    return _of


class TestHuffCatchment:
    def test_single_business_captures_the_whole_zone(
        self, conn, seed, square, catchment, caught
    ):
        """Sin competencia, el unico local se lleva toda la poblacion del radio."""
        seed_zone, _, seed_business = seed
        seed_zone("test:huff:unico", square(CENTER_LNG, CENTER_LAT, 0.004), 1000)
        seed_business("test:huff:a", "Kiosco Solo", "kiosco", CENTER_LNG, CENTER_LAT)

        catchment()
        poblacion, potencial = caught("test:huff:a")

        assert poblacion == pytest.approx(1000, rel=0.01), (
            f"sin competencia el comercio debería capturar los 1000 habitantes, "
            f"capturó {poblacion}"
        )

    def test_competition_splits_the_population(
        self, conn, seed, square, catchment, caught
    ):
        """Dos locales en el mismo punto se reparten la poblacion a la mitad."""
        seed_zone, _, seed_business = seed
        seed_zone("test:huff:comp", square(CENTER_LNG, CENTER_LAT, 0.004), 1000)
        seed_business("test:huff:b1", "Kiosco Uno", "kiosco", CENTER_LNG, CENTER_LAT)
        seed_business("test:huff:b2", "Kiosco Dos", "kiosco", CENTER_LNG + 0.00001, CENTER_LAT)

        catchment()
        p1, _ = caught("test:huff:b1")
        p2, _ = caught("test:huff:b2")

        assert p1 + p2 == pytest.approx(1000, rel=0.02), (
            f"la poblacion total no se conserva: {p1} + {p2} = {p1 + p2}"
        )
        assert p1 == pytest.approx(500, rel=0.05)

    def test_closer_business_captures_more(self, conn, seed, square, catchment, caught):
        """El decaimiento por distancia tiene que seguir el modelo."""
        seed_zone, _, seed_business = seed
        seed_zone("test:huff:dist", square(CENTER_LNG, CENTER_LAT, 0.01), 1000)
        # Dos locales separados ~900 m.
        seed_business("test:huff:cerca", "Kiosco Cerca", "kiosco", CENTER_LNG, CENTER_LAT)
        seed_business("test:huff:lejos", "Kiosco Lejos", "kiosco", CENTER_LNG + 0.008, CENTER_LAT)

        catchment()
        p_cerca, _ = caught("test:huff:cerca")
        p_lejos, _ = caught("test:huff:lejos")

        assert p_cerca > p_lejos, (
            f"el local mas cercano deberia capturar mas: {p_cerca} vs {p_lejos}"
        )
        assert p_cerca + p_lejos == pytest.approx(1000, rel=0.02)

    def test_population_is_conserved_across_all_businesses(
        self, conn, seed, square, catchment
    ):
        """Invariante del modelo: cada habitante se reparte, no se duplica.

        Este es el test que distingue a Huff de sumar radios enteros.
        """
        seed_zone, _, seed_business = seed
        seed_zone("test:huff:inv", square(CENTER_LNG, CENTER_LAT, 0.006), 2000)
        for i in range(5):
            seed_business(
                f"test:huff:inv:{i}", f"Kiosco {i}", "kiosco",
                CENTER_LNG + i * 0.001, CENTER_LAT,
            )

        catchment()

        total = conn.execute(
            "SELECT COALESCE(SUM(catchment_pop), 0)::float8 AS s FROM businesses"
        ).fetchone()["s"]
        assert total == pytest.approx(2000, rel=0.05), (
            f"la poblacion capturada deberia sumar la del radio, sumo {total}"
        )

    def test_potential_uses_the_category_ticket(
        self, conn, seed, square, catchment, caught
    ):
        """potencial = poblacion capturada x compras por habitante x ticket."""
        seed_zone, _, seed_business = seed
        seed_zone("test:huff:pot", square(CENTER_LNG, CENTER_LAT, 0.004), 1000)
        # kiosco: purchases_per_capita_month = 4, ticket_ars = 2500
        seed_business("test:huff:pot:a", "Kiosco Potencial", "kiosco", CENTER_LNG, CENTER_LAT)

        catchment()
        poblacion, potencial = caught("test:huff:pot:a")

        esperado = 1000 * 4 * 2500
        assert potencial == pytest.approx(esperado, rel=0.02), (
            f"esperado {esperado}, obtuve {potencial}"
        )

    def test_business_without_category_params_gets_no_potential(
        self, conn, seed, square, catchment, caught
    ):
        """Un rubro sin parametros no puede inventarse un potencial."""
        seed_zone, _, seed_business = seed
        seed_zone("test:huff:sin", square(CENTER_LNG, CENTER_LAT, 0.004), 1000)
        seed_business("test:huff:sin:a", "Algo Raro", "rubro_inexistente", CENTER_LNG, CENTER_LAT)

        catchment()
        poblacion, potencial = caught("test:huff:sin:a")

        assert potencial is None
        assert poblacion is not None, "la poblacion capturada no depende del rubro"

    def test_population_outside_max_distance_is_not_counted(
        self, conn, seed, square, catchment, caught
    ):
        """Fuera del radio maximo no hay catchment: no inventamos clientes."""
        seed_zone, _, seed_business = seed
        # Radio a 5 km del comercio, muy lejos del maximo por defecto.
        seed_zone("test:huff:lejos", square(CENTER_LNG + 0.05, CENTER_LAT, 0.002), 5000)
        seed_business("test:huff:lejos:a", "Kiosco Solo", "kiosco", CENTER_LNG, CENTER_LAT)

        catchment()
        poblacion, _ = caught("test:huff:lejos:a")

        assert poblacion == pytest.approx(0, abs=1), f"capturó {poblacion} a 5 km"

    def test_store_with_no_customers_gets_zero_not_null(
        self, conn, seed, square, catchment, caught
    ):
        """Un local sin catchment tiene 0, no NULL: cero clientes es un dato."""
        seed_zone, _, seed_business = seed
        seed_business("test:huff:aire:a", "Kiosco Al Aire", "kiosco", CENTER_LNG, CENTER_LAT)

        catchment()
        poblacion, _ = caught("test:huff:aire:a")
        assert poblacion == 0


class TestCaptureTier:
    """El tier que usa el mapa cuando no hay reseñas para calcular facturación."""

    def _tier(self, conn, place_id):
        row = conn.execute(
            "SELECT capture_tier FROM businesses WHERE place_id = %s", (place_id,)
        ).fetchone()
        return None if row is None else row["capture_tier"]

    def test_known_category_always_gets_a_tier(self, conn, seed, square, catchment):
        seed_zone, _, seed_business = seed
        seed_zone("test:tier:grande", square(CENTER_LNG, CENTER_LAT, 0.02), 20000)
        seed_business(
            "test:tier:super", "Supermercado", "supermercado", CENTER_LNG, CENTER_LAT
        )

        catchment()
        tier = self._tier(conn, "test:tier:super")
        assert tier is not None, "un rubro conocido siempre tiene tier"
        assert 1 <= tier <= 5

    def test_tier_is_null_for_unknown_category(self, conn, seed, square, catchment):
        seed_zone, _, seed_business = seed
        seed_zone("test:tier:raro", square(CENTER_LNG, CENTER_LAT, 0.004), 5000)
        seed_business(
            "test:tier:raro:a", "Negocio Raro", "rubro_inexistente", CENTER_LNG, CENTER_LAT
        )

        catchment()
        assert self._tier(conn, "test:tier:raro:a") is None, (
            "sin parámetros de rubro no se puede clasificar el tamaño"
        )

    def test_tiers_stay_within_range(self, conn, seed, square, catchment):
        seed_zone, _, seed_business = seed
        seed_zone("test:tier:chk", square(CENTER_LNG, CENTER_LAT, 0.01), 9000)
        for i in range(4):
            seed_business(
                f"test:tier:chk:{i}", f"Kiosco {i}", "kiosco",
                CENTER_LNG + i * 0.002, CENTER_LAT,
            )

        catchment()
        tiers = [self._tier(conn, f"test:tier:chk:{i}") for i in range(4)]
        assert all(t is None or 1 <= t <= 5 for t in tiers), f"tier fuera de rango: {tiers}"