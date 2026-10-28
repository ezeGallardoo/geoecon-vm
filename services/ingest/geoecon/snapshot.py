"""Foto estática de la grilla. No consulta Google Maps."""

from __future__ import annotations

import json
import math
from pathlib import Path

SOUTH = -32.45
NORTH = -32.38
WEST = -63.28
EAST = -63.20
LAT0 = -32.41
LAT_STEP = 400.0 / 110540.0
LNG_STEP = 400.0 / (111320.0 * math.cos(math.radians(LAT0)))

REPO_ROOT = Path(__file__).resolve().parents[3]
GRID_PATH = REPO_ROOT / "apps" / "web" / "public" / "snapshot" / "grid.geojson"


def grid_collection() -> dict:
    features = []
    lat = SOUTH
    row = 0
    while lat < NORTH - 1e-12:
        lng = WEST
        col = 0
        next_lat = min(lat + LAT_STEP, NORTH)
        while lng < EAST - 1e-12:
            next_lng = min(lng + LNG_STEP, EAST)
            features.append(
                {
                    "type": "Feature",
                    "properties": {"row": row, "col": col, "cell_m": 400},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [
                            [
                                [lng, lat],
                                [next_lng, lat],
                                [next_lng, next_lat],
                                [lng, next_lat],
                                [lng, lat],
                            ]
                        ],
                    },
                }
            )
            col += 1
            lng = next_lng
        row += 1
        lat = next_lat
    return {
        "type": "FeatureCollection",
        "properties": {
            "source": "generate_vm_grid constants",
            "south": SOUTH,
            "north": NORTH,
            "west": WEST,
            "east": EAST,
        },
        "features": features,
    }


def write_grid(path: Path = GRID_PATH) -> int:
    collection = grid_collection()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(collection, separators=(",", ":")))
    return len(collection["features"])
