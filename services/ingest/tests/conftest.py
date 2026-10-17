"""Harness de integración contra PostGIS.

Cada test corre dentro de una transacción que se revierte al final, de modo que
ninguno ve los datos de otro. La base real del proyecto nunca se toca.
"""

from __future__ import annotations

import json
import os

import psycopg
import pytest
from psycopg.rows import dict_row

DEFAULT_URL = "postgresql://geoecon:geoecon@localhost:5435/geoecon"


@pytest.fixture
def conn():
    """Conexión con rollback garantizado, incluso si el test falla."""
    dsn = os.environ.get("DATABASE_URL", DEFAULT_URL)
    try:
        connection = psycopg.connect(dsn, row_factory=dict_row)
    except psycopg.OperationalError as exc:
        pytest.skip(f"PostGIS no está disponible ({dsn}): {exc}")

    connection.autocommit = False
    try:
        yield connection
    finally:
        connection.rollback()
        connection.close()


def _multipolygon(geojson_geom: dict) -> str:
    """Misma normalización que.indec.py y barrios.py: a MultiPolygon válido."""
    kind = geojson_geom["type"]
    if kind == "MultiPolygon":
        return json.dumps(geojson_geom)
    if kind == "Polygon":
        return json.dumps({"type": "MultiPolygon", "coordinates": [geojson_geom["coordinates"]]})
    raise ValueError(f"geometría no poligonal: {kind}")


@pytest.fixture(autouse=True)
def isolated(conn):
    """Vacía las tablas geoespaciales para que los tests midan lo que siembran.

    Los datos reales del proyecto están cargados en esta base, así que sin esto
    `radius_report` devolvería la población real de Villa María y los asserts
    no significarían nada. El rollback del fixture `conn` los restaura después.
    """
    conn.execute("DELETE FROM businesses")
    conn.execute("DELETE FROM urban_zones")
    conn.execute("DELETE FROM neighborhoods")
    yield


@pytest.fixture
def seed(conn):
    """Inserta zonas y barrios de prueba. Devuelve funciones para sembrar y leer."""

    def _seed_zone(zone_id: str, geojson_geom: dict, population: int, **cols) -> str:
        conn.execute(
            """
            INSERT INTO urban_zones (zone_id, geom, population, source)
            VALUES (
                %(zone_id)s,
                ST_Multi(ST_CollectionExtract(
                    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)), 3)),
                %(population)s,
                'indec'
            )
            ON CONFLICT (zone_id) DO UPDATE
                SET geom = EXCLUDED.geom, population = EXCLUDED.population
            """,
            {"zone_id": zone_id, "geom": _multipolygon(geojson_geom), "population": population},
        )
        return zone_id

    def _seed_neighborhood(
        neighborhood_id: str,
        geojson_geom: dict,
        land_value_m2: float | None = None,
        source: str = "municipio",
        population: int = 0,
    ) -> str:
        conn.execute(
            """
            INSERT INTO neighborhoods (neighborhood_id, name, geom, land_value_m2, population, source)
            VALUES (
                %(neighborhood_id)s,
                %(neighborhood_id)s,
                ST_Multi(ST_CollectionExtract(
                    ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)), 3)),
                %(land_value_m2)s,
                %(population)s,
                %(source)s
            )
            ON CONFLICT (neighborhood_id) DO UPDATE
                SET geom = EXCLUDED.geom, land_value_m2 = EXCLUDED.land_value_m2
            """,
            {
                "neighborhood_id": neighborhood_id,
                "geom": _multipolygon(geojson_geom),
                "land_value_m2": land_value_m2,
                "population": population,
                "source": source,
            },
        )
        return neighborhood_id

    def _seed_business(place_id: str, name: str, category: str, lng: float, lat: float, **cols) -> str:
        row = conn.execute(
            """
            SELECT upsert_business(jsonb_build_object(
                'place_id', %(place_id)s,
                'name', %(name)s,
                'category', %(category)s,
                'lng', %(lng)s,
                'lat', %(lat)s,
                'source', 'manual'
            )) AS id
            """,
            {"place_id": place_id, "name": name, "category": category, "lng": lng, "lat": lat},
        ).fetchone()
        return str(row["id"])

    return _seed_zone, _seed_neighborhood, _seed_business


@pytest.fixture
def square():
    """Rectángulo en grados alrededor de un punto, como dict GeoJSON."""

    def _square(lng: float, lat: float, half_size_deg: float = 0.002) -> dict:
        return {
            "type": "Polygon",
            "coordinates": [
                [
                    [lng - half_size_deg, lat - half_size_deg],
                    [lng + half_size_deg, lat - half_size_deg],
                    [lng + half_size_deg, lat + half_size_deg],
                    [lng - half_size_deg, lat + half_size_deg],
                    [lng - half_size_deg, lat - half_size_deg],
                ]
            ],
        }

    return _square


@pytest.fixture
def radius_report(conn):
    """Llama a radius_report y devuelve el dict de la función."""

    def _call(lat: float, lng: float, meters: float) -> dict:
        row = conn.execute(
            "SELECT radius_report(%s, %s, %s) AS report",
            (lat, lng, meters),
        ).fetchone()
        return row["report"]

    return _call