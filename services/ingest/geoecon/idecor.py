from __future__ import annotations

import json

import httpx
from shapely.geometry import shape

from geoecon.config import Settings


def list_land_layers(settings: Settings) -> list[str]:
    response = httpx.get(
        settings.idecor_wfs_url,
        params={"service": "WFS", "request": "GetCapabilities"},
        timeout=120,
        headers={"User-Agent": "GeoEconVM/2.0 (uso interno Villa Maria)"},
    )
    response.raise_for_status()
    import re

    names = re.findall(r"<Name>([^<]+)</Name>", response.text)
    keywords = ("tierra", "vut", "valor", "suelo")
    return [name for name in names if any(word in name.lower() for word in keywords)]


def import_land_value(conn, settings: Settings, type_name: str, value_field: str) -> int:
    """Trae el VUT del WFS de IDECOR recortado al bbox y lo promedia sobre los radios ya cargados.

    Si todavía no hay radios del INDEC, guarda cada polígono como zona `idecor:*`
    para que el mapa pueda pintar el valor del suelo igual.
    """
    south, west, north, east = settings.south, settings.west, settings.north, settings.east
    response = httpx.get(
        settings.idecor_wfs_url,
        params={
            "service": "WFS",
            "version": "1.0.0",
            "request": "GetFeature",
            "typeName": type_name,
            "outputFormat": "application/json",
            "srsName": "EPSG:4326",
            "bbox": f"{west},{south},{east},{north}",
        },
        timeout=300,
        headers={"User-Agent": "GeoEconVM/2.0 (uso interno Villa Maria)"},
    )
    response.raise_for_status()
    features = response.json().get("features") or []

    conn.execute(
        """
        CREATE TEMP TABLE land_parcels (
            geom GEOMETRY(Geometry, 4326) NOT NULL,
            value NUMERIC(12,2) NOT NULL
        ) ON COMMIT DROP
        """
    )
    loaded = 0
    for feature in features:
        props = feature.get("properties") or {}
        raw = props.get(value_field)
        geometry = feature.get("geometry")
        if raw in (None, "") or not geometry:
            continue
        geom = shape(geometry)
        if geom.is_empty:
            continue
        conn.execute(
            "INSERT INTO land_parcels (geom, value) VALUES (ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s)",
            (json.dumps(geometry), raw),
        )
        loaded += 1

    zones = conn.execute("SELECT COUNT(*) AS n FROM urban_zones").fetchone()["n"]
    if zones:
        conn.execute(
            """
            UPDATE urban_zones z
            SET land_value_m2 = src.avg_value
            FROM (
                SELECT z2.zone_id, ROUND(AVG(p.value), 2) AS avg_value
                FROM urban_zones z2
                JOIN land_parcels p ON ST_Intersects(z2.geom, p.geom)
                GROUP BY z2.zone_id
            ) src
            WHERE z.zone_id = src.zone_id
            """
        )
    else:
        conn.execute(
            """
            INSERT INTO urban_zones (zone_id, geom, land_value_m2, source, population, households)
            SELECT
                'idecor:' || substr(md5(ST_AsBinary(geom)), 1, 16),
                CASE
                    WHEN GeometryType(geom) = 'POLYGON' THEN ST_Multi(geom)
                    ELSE geom
                END,
                value,
                'idecor',
                0,
                0
            FROM land_parcels
            WHERE GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON')
            ON CONFLICT (zone_id) DO UPDATE SET land_value_m2 = EXCLUDED.land_value_m2
            """
        )

    conn.execute(
        """
        UPDATE businesses b
        SET zone_id = z.zone_id
        FROM urban_zones z
        WHERE b.zone_id IS NULL
          AND ST_Intersects(z.geom, b.geom)
        """
    )
    conn.execute("SELECT recalculate_estimates()")
    conn.commit()
    return loaded
