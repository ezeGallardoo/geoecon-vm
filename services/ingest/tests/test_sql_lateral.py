"""El join lateral que usa /api/businesses para resolver el barrio de cada punto.

Replica el criterio de apps/web/src/app/api/businesses/[id]/route.ts: gana el
polígono de menor área que contiene al punto, para que un barrio grande no se
coma a uno chico superpuesto.
"""

import pytest


@pytest.fixture
def lateral_lookup(conn):
    """Ejecuta el mismo join que la API y devuelve id de barrio -> barrio."""

    def _lookup(lat: float, lng: float):
        row = conn.execute(
            """
            SELECT n.neighborhood_id AS "neighborhoodId"
            FROM (SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS geom) b
            LEFT JOIN LATERAL (
                SELECT neighborhood_id
                FROM neighborhoods
                WHERE ST_Intersects(geom, b.geom)
                ORDER BY ST_Area(geom::geography)
                LIMIT 1
            ) n ON true
            """,
            (lng, lat),
        ).fetchone()
        return row["neighborhoodId"]

    return _lookup


class TestLateralNeighborhoodLookup:
    def test_point_inside_one_neighborhood(self, conn, seed, square, lateral_lookup):
        _, seed_barrio, _ = seed
        seed_barrio("test:lat:unico", square(-63.2436, -32.4103, 0.004), 100000)

        assert lateral_lookup(-32.4103, -63.2436) == "test:lat:unico"

    def test_smaller_neighborhood_wins_when_they_overlap(self, conn, seed, square, lateral_lookup):
        """Criterio de desempate por área: el más chico gana."""
        _, seed_barrio, _ = seed
        seed_barrio("test:lat:grande", square(-63.2436, -32.4103, 0.01), 100000)
        seed_barrio("test:lat:chico", square(-63.2436, -32.4103, 0.001), 200000)

        assert lateral_lookup(-32.4103, -63.2436) == "test:lat:chico"

    def test_point_outside_every_neighborhood_is_null(self, conn, seed, square, lateral_lookup):
        _, seed_barrio, _ = seed
        seed_barrio("test:lat:lejos", square(-63.2436 + 0.05, -32.4103, 0.001), 100000)

        assert lateral_lookup(-32.4103, -63.2436) is None

    def test_neighborhood_without_businesses_still_exists(self, conn, seed, square, lateral_lookup):
        """El mapa pinta barrios vacíos igual: el id tiene que estar disponible."""
        _, seed_barrio, _ = seed
        seed_barrio("test:lat:vacio", square(-63.2436, -32.4103, 0.004), 100000)

        rows = conn.execute(
            "SELECT neighborhood_id FROM neighborhoods WHERE neighborhood_id = 'test:lat:vacio'"
        ).fetchall()
        assert len(rows) == 1