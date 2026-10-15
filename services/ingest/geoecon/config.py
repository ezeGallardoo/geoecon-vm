from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    bcra_deudas_url: str
    idecor_wfs_url: str
    overpass_url: str
    south: float = -32.45
    north: float = -32.38
    west: float = -63.28
    east: float = -63.20


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ.get(
            "DATABASE_URL",
            "postgresql://geoecon:geoecon@localhost:5435/geoecon",
        ),
        bcra_deudas_url=os.environ.get(
            "BCRA_DEUDAS_URL",
            "https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/{cuit}",
        ),
        idecor_wfs_url=os.environ.get(
            "IDECOR_WFS_URL",
            "https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs",
        ),
        overpass_url=os.environ.get(
            "OVERPASS_URL",
            "https://overpass-api.de/api/interpreter",
        ),
    )
