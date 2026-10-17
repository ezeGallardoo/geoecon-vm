from __future__ import annotations

import io
import json
import math
import re
import unicodedata
import zipfile
from pathlib import Path

import httpx
import shapefile
from pyproj import CRS, Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union

from geoecon.naming import display_name, zone_name

VILLA_NUEVA_LAYER = "idecor:villa_nva_cod_urb_rur"
VILLA_NUEVA_SOURCE = "idecor-vn"

BARRIOS_URL = "https://datos.villamaria.gob.ar/recurso/645d9b9c-7035-499b-91bf-a8627aab2609/descargar"


def import_barrios(conn, path: Path | None = None) -> int:
    """Carga los polígonos de barrios de la Municipalidad y les asigna población y VUT.

    La población sale del radio censal cuyo centro cae en el barrio. El valor por m²
    es el promedio de los radios, ponderado por el área de la intersección.
    """
    features = _features(path)
    conn.execute("DELETE FROM neighborhoods WHERE source = 'municipio'")
    for feature in features:
        name = display_name(str(feature["properties"].get("NOMBRE") or "").strip())
        if not name:
            continue
        conn.execute(
            """
            INSERT INTO neighborhoods (neighborhood_id, name, geom, source)
            VALUES (
                %s,
                %s,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)),
                'municipio'
            )
            """,
            (_barrio_id(name), name, _geojson(feature["geometry"])),
        )
    conn.execute(
        """
        UPDATE neighborhoods n
        SET land_value_m2 = src.land_value,
            population = src.population
        FROM (
            SELECT
                n2.neighborhood_id,
                ROUND((
                    SUM(z.land_value_m2 * ST_Area(ST_Intersection(ST_MakeValid(n2.geom), ST_MakeValid(z.geom))::geography))
                        FILTER (WHERE z.land_value_m2 > 0)
                    / NULLIF(
                        SUM(ST_Area(ST_Intersection(ST_MakeValid(n2.geom), ST_MakeValid(z.geom))::geography))
                            FILTER (WHERE z.land_value_m2 > 0),
                        0
                    )
                )::NUMERIC, 2) AS land_value,
                COALESCE(SUM(z.population) FILTER (
                    WHERE ST_Contains(ST_MakeValid(n2.geom), ST_PointOnSurface(ST_MakeValid(z.geom)))
                ), 0)::INTEGER AS population
            FROM neighborhoods n2
            JOIN urban_zones z
              ON z.source = 'indec'
             AND ST_Intersects(n2.geom, z.geom)
            GROUP BY n2.neighborhood_id
        ) src
        WHERE n.neighborhood_id = src.neighborhood_id
        """
    )
    conn.commit()
    row = conn.execute("SELECT COUNT(*) AS n FROM neighborhoods").fetchone()
    return int(row["n"] if row else 0)


def _features(path: Path | None) -> list[dict]:
    if path is None:
        response = httpx.get(BARRIOS_URL, timeout=60, follow_redirects=True)
        response.raise_for_status()
        archive = zipfile.ZipFile(io.BytesIO(response.content))
        target = Path("/tmp/geoecon-barrios")
        target.mkdir(parents=True, exist_ok=True)
        archive.extractall(target)
        matches = list(target.glob("*.shp"))
        if not matches:
            raise FileNotFoundError("el zip municipal no trae un shapefile")
        path = matches[0]
    return _load_shp(path)


def _load_shp(path: Path) -> list[dict]:
    reader = shapefile.Reader(str(path), encoding="utf-8")
    prj = path.with_suffix(".prj")
    source = CRS.from_user_input(prj.read_text(encoding="utf-8")) if prj.exists() else CRS.from_epsg(4326)
    transformer = None
    if not source.equals(CRS.from_epsg(4326)):
        transformer = Transformer.from_crs(source, CRS.from_epsg(4326), always_xy=True)
    fields = [field[0] for field in reader.fields[1:]]
    features = []
    for shape_record in reader.iterShapeRecords():
        geom = shape(shape_record.shape.__geo_interface__)
        if transformer is not None:
            geom = transform(transformer.transform, geom)
        features.append({"properties": dict(zip(fields, shape_record.record)), "geometry": mapping(geom)})
    return features


def import_villa_nueva(conn, wfs_url: str) -> int:
    """Carga las zonas del código urbanístico 2026 de Villa Nueva.

    El municipio no publica barrios. La capa oficial es idecor:villa_nva_cod_urb_rur.
    Lo que pisa un barrio de Villa María se recorta, para no pintar dos veces el mismo suelo.
    La población del censo se reparte por el área del radio que cae en cada zona.
    """
    features = _villa_nueva_features(wfs_url)
    city = _municipio_union(conn)
    conn.execute("DELETE FROM neighborhoods WHERE source = %s", (VILLA_NUEVA_SOURCE,))
    loaded = 0
    for feature in features:
        props = feature.get("properties") or {}
        name = zone_name(str(props.get("name") or ""))
        if not name:
            continue
        geom = _clip_to_city(shape(feature["geometry"]), city)
        if geom is None:
            continue
        feature_id = str(feature.get("id") or "")
        suffix = feature_id.rsplit(".", 1)[-1] or str(loaded)
        conn.execute(
            """
            INSERT INTO neighborhoods (neighborhood_id, name, geom, source)
            VALUES (
                %s,
                %s,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)),
                %s
            )
            """,
            (f"vn:{suffix}", name, _geojson(mapping(geom)), VILLA_NUEVA_SOURCE),
        )
        loaded += 1
    conn.execute(
        """
        UPDATE neighborhoods n
        SET land_value_m2 = src.land_value,
            population = src.population
        FROM (
            SELECT
                n2.neighborhood_id,
                ROUND((
                    SUM(z.land_value_m2 * ST_Area(ST_Intersection(ST_MakeValid(n2.geom), ST_MakeValid(z.geom))::geography))
                        FILTER (WHERE z.land_value_m2 > 0)
                    / NULLIF(
                        SUM(ST_Area(ST_Intersection(ST_MakeValid(n2.geom), ST_MakeValid(z.geom))::geography))
                            FILTER (WHERE z.land_value_m2 > 0),
                        0
                    )
                )::NUMERIC, 2) AS land_value,
                COALESCE(ROUND(SUM(
                    z.population::NUMERIC
                    * ST_Area(ST_Intersection(ST_MakeValid(n2.geom), ST_MakeValid(z.geom))::geography)
                    / NULLIF(ST_Area(ST_MakeValid(z.geom)::geography), 0)
                )), 0)::INTEGER AS population
            FROM neighborhoods n2
            JOIN urban_zones z
              ON z.source = 'indec'
             AND ST_Intersects(n2.geom, z.geom)
            WHERE n2.source = %s
            GROUP BY n2.neighborhood_id
        ) src
        WHERE n.neighborhood_id = src.neighborhood_id
        """,
        (VILLA_NUEVA_SOURCE,),
    )
    conn.commit()
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM neighborhoods WHERE source = %s",
        (VILLA_NUEVA_SOURCE,),
    ).fetchone()
    return int(row["n"] if row else 0)


def _villa_nueva_features(wfs_url: str) -> list[dict]:
    response = httpx.get(
        wfs_url,
        params={
            "service": "WFS",
            "version": "1.0.0",
            "request": "GetFeature",
            "typeName": VILLA_NUEVA_LAYER,
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
        },
        timeout=90,
        headers={"User-Agent": "GeoEconVM/2.0"},
        follow_redirects=True,
    )
    response.raise_for_status()
    return response.json().get("features") or []


def _municipio_union(conn):
    rows = conn.execute(
        "SELECT ST_AsGeoJSON(geom) AS geom FROM neighborhoods WHERE source = 'municipio'"
    ).fetchall()
    if not rows:
        return None
    return unary_union([shape(json.loads(row["geom"])) for row in rows])


def _clip_to_city(geom, city):
    if city is not None and geom.intersects(city):
        geom = geom.difference(city)
    if geom.geom_type == "GeometryCollection":
        parts = [part for part in geom.geoms if part.geom_type in ("Polygon", "MultiPolygon")]
        geom = unary_union(parts) if parts else None
    if geom is None or geom.is_empty:
        return None
    if _area_m2(geom) < 2000:
        return None
    return geom


def _area_m2(geom) -> float:
    centroid = geom.centroid
    return geom.area * 111_320 * 110_540 * math.cos(math.radians(centroid.y))


def _barrio_id(name: str) -> str:
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return f"barrio:{slug}"


def _geojson(geometry: dict) -> str:
    import json

    return json.dumps(geometry)
