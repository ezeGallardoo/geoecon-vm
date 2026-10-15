from __future__ import annotations

import json
from pathlib import Path

import shapefile
from pyproj import CRS, Transformer
from shapely.geometry import mapping, shape


def _as_multipolygon(geojson_geom: dict) -> dict:
    kind = geojson_geom["type"]
    if kind == "MultiPolygon":
        return geojson_geom
    if kind == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [geojson_geom["coordinates"]]}
    raise ValueError(f"geometría no poligonal: {kind}")


def _load_geojson(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["features"] if data.get("type") == "FeatureCollection" else data["features"]


def _load_shp(path: Path) -> list[dict]:
    reader = shapefile.Reader(str(path), encoding="latin-1")
    source = CRS.from_user_input(_prj_text(path) or "EPSG:4326")
    transformer = None
    if not source.equals(CRS.from_epsg(4326)):
        transformer = Transformer.from_crs(source, CRS.from_epsg(4326), always_xy=True)
    features = []
    fields = [field[0] for field in reader.fields[1:]]
    for shape_record in reader.iterShapeRecords():
        geom = shape(shape_record.shape.__geo_interface__)
        if transformer is not None:
            from shapely.ops import transform

            geom = transform(transformer.transform, geom)
        props = dict(zip(fields, shape_record.record))
        features.append({"properties": props, "geometry": mapping(geom)})
    return features


def _prj_text(path: Path) -> str | None:
    prj = path.with_suffix(".prj")
    if prj.exists():
        return prj.read_text(encoding="utf-8", errors="ignore")
    return None


def import_zones(
    conn,
    path: Path,
    id_field: str,
    population_field: str,
    households_field: str | None,
    name_field: str | None,
) -> int:
    features = _load_shp(path) if path.suffix.lower() == ".shp" else _load_geojson(path)
    written = 0
    for feature in features:
        props = feature.get("properties") or {}
        zone_id = str(props.get(id_field) or "").strip()
        if not zone_id:
            continue
        population = int(props.get(population_field) or 0)
        households = int(props.get(households_field) or 0) if households_field else 0
        name = str(props.get(name_field))[:100] if name_field and props.get(name_field) else None
        geom = _as_multipolygon(feature["geometry"])
        conn.execute(
            """
            INSERT INTO urban_zones (zone_id, neighborhood_name, geom, population, households, source)
            VALUES (
                %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s, 'indec'
            )
            ON CONFLICT (zone_id) DO UPDATE SET
                neighborhood_name = EXCLUDED.neighborhood_name,
                geom = EXCLUDED.geom,
                population = EXCLUDED.population,
                households = EXCLUDED.households
            """,
            (zone_id, name, json.dumps(geom), population, households),
        )
        written += 1

    conn.execute(
        """
        UPDATE businesses b
        SET zone_id = z.zone_id
        FROM urban_zones z
        WHERE z.source = 'indec'
          AND ST_Intersects(z.geom, b.geom)
        """
    )
    conn.execute("SELECT recalculate_estimates()")
    conn.commit()
    return written
