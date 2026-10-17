"""assign_business_neighborhoods(): materializa a qué barrio pertenece cada comercio.

El visor lee la columna en vez de resolver el punto en el navegador, y la ficha
individual usa la misma columna, así que lista y detalle no pueden discrepar.
"""

import pytest

CENTER_LAT = -32.4103
CENTER_LNG = -63.2436


@pytest.fixture
def assign(conn):
    """Ejecuta la función y devuelve el conteo de comercios asignados."""

    def _run() -> int:
        row = conn.execute("SELECT assign_business_neighborhoods() AS n").fetchone()
        return int(row["n"])

    return _run


@pytest.fixture
def assigned(conn):
    """Devuelve el barrio asignado a un comercio por place_id."""

    def _of(place_id: str):
        row = conn.execute(
            "SELECT neighborhood_id FROM businesses WHERE place_id = %s",
            (place_id,),
        ).fetchone()
        return None if row is None else row["neighborhood_id"]

    return _of


class TestAssignNeighborhoods:
    def test_business_inside_a_neighborhood(self, conn, seed, square, assign, assigned):
        _, seed_barrio, seed_business = seed
        seed_barrio("test:asig:unico", square(CENTER_LNG, CENTER_LAT, 0.004), 100000)
        seed_business("test:negocio:a", "Kiosco A", "kiosco", CENTER_LNG, CENTER_LAT)

        assign()
        assert assigned("test:negocio:a") == "test:asig:unico"

    def test_smallest_neighborhood_wins(self, conn, seed, square, assign, assigned):
        """Criterio de desempate por área: el polígono más chico gana."""
        _, seed_barrio, seed_business = seed
        seed_barrio("test:asig:grande", square(CENTER_LNG, CENTER_LAT, 0.01), 100000)
        seed_barrio("test:asig:chico", square(CENTER_LNG, CENTER_LAT, 0.001), 200000)
        seed_business("test:negocio:b", "Kiosco B", "kiosco", CENTER_LNG, CENTER_LAT)

        assign()
        assert assigned("test:negocio:b") == "test:asig:chico"

    def test_business_outside_every_neighborhood_stays_null(self, conn, seed, square, assign, assigned):
        _, seed_barrio, seed_business = seed
        seed_barrio("test:asig:lejos", square(CENTER_LNG + 0.05, CENTER_LAT, 0.001), 100000)
        seed_business("test:negocio:c", "Kiosco C", "kiosco", CENTER_LNG, CENTER_LAT)

        assign()
        assert assigned("test:negocio:c") is None

    def test_stale_assignment_is_cleared_when_the_neighborhood_moves(
        self, conn, seed, square, assign, assigned
    ):
        """Si el barrio se borra y se recarga, el comercio no puede quedar apuntando al viejo."""
        _, seed_barrio, seed_business = seed
        seed_barrio("test:asig:viejo", square(CENTER_LNG, CENTER_LAT, 0.004), 100000)
        seed_business("test:negocio:d", "Kiosco D", "kiosco", CENTER_LNG, CENTER_LAT)
        assign()
        assert assigned("test:negocio:d") == "test:asig:viejo"

        # El municipio redefinió los barrios: el viejo desaparece.
        conn.execute("DELETE FROM neighborhoods WHERE neighborhood_id = 'test:asig:viejo'")
        seed_barrio("test:asig:nuevo", square(CENTER_LNG, CENTER_LAT, 0.004), 150000)

        assign()
        assert assigned("test:negocio:d") == "test:asig:nuevo"

    def test_matches_a_spatial_lookup_row_for_row(self, conn, seed, square, assign):
        """La columna tiene que decir exactamente lo mismo que resolverlo por geometría.

        Si divergen, la lista y la ficha muestran barrios distintos.
        """
        _, seed_barrio, seed_business = seed
        seed_barrio("test:asig:eq:grande", square(CENTER_LNG, CENTER_LAT, 0.02), 100000)
        seed_barrio("test:asig:eq:chico", square(CENTER_LNG, CENTER_LAT, 0.003), 200000)
        for index, lng in enumerate([-63.2436, -63.2400, -63.2500, -63.2350]):
            seed_business(f"test:negocio:eq:{index}", f"Kiosco {index}", "kiosco", lng, CENTER_LAT)

        assign()

        rows = conn.execute(
            """
            SELECT b.place_id, b.neighborhood_id AS columnado,
                   (SELECT neighborhood_id FROM neighborhoods
                     WHERE ST_Intersects(geom, b.geom)
                     ORDER BY ST_Area(geom) LIMIT 1) AS espacial
            FROM businesses b ORDER BY b.place_id
            """
        ).fetchall()
        assert len(rows) == 4
        for row in rows:
            assert row["columnado"] == row["espacial"], (
                f"{row['place_id']}: columna={row['columnado']} espacial={row['espacial']}"
            )