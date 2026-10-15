from __future__ import annotations

import csv
import json
import sys
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


def prepare_san_martin(csv_path: Path, out_path: Path) -> int:
    """Recorta los radios 2022 del departamento General San Martín (Córdoba, 14-042).

    El CSV nacional de INDEC trae población y la geometría en WKT. El centro de
    Villa María cae en el departamento 042.
    """
    from shapely import wkt
    from shapely.geometry import mapping

    csv.field_size_limit(sys.maxsize)
    features: list[dict] = []
    population = 0
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row.get("cod_prov") != "14" or row.get("cod_dep") != "042":
                continue
            geom = wkt.loads(row["wkt"])
            if geom.is_empty:
                continue
            if not geom.is_valid:
                geom = geom.buffer(0)
            people = int(row.get("POB_TOT_P") or 0)
            population += people
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "codigo": row["codigo"],
                        "poblacion": people,
                        "nombre": f"Radio {row['fraccion']}-{row['radio']}",
                    },
                    "geometry": mapping(geom),
                }
            )
    out_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}),
        encoding="utf-8",
    )
    print(f"radios: {len(features)}; poblacion: {population}")
    return len(features)


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
                %s,
                %s,
                ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)),
                %s,
                %s,
                'indec'
            )
            ON CONFLICT (zone_id) DO UPDATE SET
                neighborhood_name = EXCLUDED.neighborhood_name,
                geom = EXCLUDED.geom,
                population = EXCLUDED.population,
                households = EXCLUDED.households,
                source = 'indec'
            """,
            (zone_id, name, json.dumps(geom), population, households),
        )
        written += 1

    conn.execute(
        """
        UPDATE businesses b
        SET zone_id = picked.zone_id
        FROM (
            SELECT DISTINCT ON (b2.id) b2.id AS business_id, z.zone_id
            FROM businesses b2
            JOIN urban_zones z
              ON z.source = 'indec'
             AND ST_Intersects(z.geom, b2.geom)
            ORDER BY b2.id, ST_Area(z.geom::geography)
        ) AS picked
        WHERE b.id = picked.business_id
        """
    )
    conn.execute("SELECT recalculate_estimates()")
    conn.commit()
    return written
