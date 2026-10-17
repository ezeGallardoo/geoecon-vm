from __future__ import annotations

import argparse
from pathlib import Path

from geoecon.categories import cuit_is_valid, weekly_hours_from_osm
from geoecon.config import load_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingesta GeoEcon VM")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("grid", help="Regenera la grilla de 400 m de Villa María")
    sub.add_parser("osm", help="Importa comercios de OpenStreetMap en el bbox")
    sub.add_parser("estimate", help="Recalcula tier e ingreso estimado")
    sub.add_parser("reclassify", help="Saca de Otro los comercios cuya etiqueta OSM ya tiene rubro")

    bcra = sub.add_parser("bcra", help="Consulta la Central de Deudores para un CUIT ya vinculado")
    bcra.add_argument("--cuit", required=True)

    layers = sub.add_parser("idecor-layers", help="Lista capas del WFS de IDECOR que parecen valor de suelo")
    land = sub.add_parser("idecor", help="Carga el valor de la tierra desde una capa WFS")
    land.add_argument("--layer", required=True, help="typeName, por ejemplo el que devuelve idecor-layers")
    land.add_argument("--value-field", required=True, help="Atributo numérico del VUT en esa capa")

    sub.add_parser(
        "census-vm",
        help="Recorta el CSV nacional 2022 al departamento General San Martín y lo carga",
    )
    barrios = sub.add_parser("barrios", help="Carga los barrios municipales y les asigna el VUT")
    barrios.add_argument("--path", type=Path, help="Shapefile local. Si se omite, descarga el de datos abiertos.")
    sub.add_parser("villa-nueva", help="Carga las zonas del código urbanístico 2026 de Villa Nueva")

    census = sub.add_parser("indec", help="Importa radios censales GeoJSON o Shapefile")
    census.add_argument("--path", required=True, type=Path)
    census.add_argument("--id-field", required=True)
    census.add_argument("--population-field", required=True)
    census.add_argument("--households-field")
    census.add_argument("--name-field")

    fiscal = sub.add_parser("arca-csv", help="Vincula un CSV local de CUIT. No consulta ARCA en línea")
    fiscal.add_argument("--path", required=True, type=Path)

    sub.add_parser(
        "catchment",
        help="Recalcula el catchment y el tier por tamaño con el modelo de Huff",
    )

    sub.add_parser("selftest", help="Pruebas locales sin base")

    args = parser.parse_args()
    if args.command == "selftest":
        _selftest()
        return

    settings = load_settings()
    from geoecon.db import connect

    with connect(settings) as conn:
        if args.command == "grid":
            count = conn.execute("SELECT generate_vm_grid() AS n").fetchone()["n"]
            conn.commit()
            print(f"celdas: {count}")
        elif args.command == "osm":
            from geoecon.osm import import_osm

            print(f"comercios osm: {import_osm(conn, settings)}")
        elif args.command == "estimate":
            count = conn.execute("SELECT recalculate_estimates() AS n").fetchone()["n"]
            conn.commit()
            print(f"estimados: {count}")
        elif args.command == "catchment":
            count = conn.execute("SELECT assign_business_catchment() AS n").fetchone()["n"]
            conn.commit()
            print(f"catchments: {count}")
        elif args.command == "reclassify":
            from geoecon.categories import reclassify_otro

            print(f"reclasificados: {reclassify_otro(conn)}")
        elif args.command == "bcra":
            from geoecon.bcra import apply_bcra

            print(f"comercios actualizados: {apply_bcra(conn, settings, args.cuit)}")
        elif args.command == "idecor-layers":
            from geoecon.idecor import list_land_layers

            for name in list_land_layers(settings):
                print(name)
        elif args.command == "idecor":
            from geoecon.idecor import import_land_value

            print(f"parcelas leídas: {import_land_value(conn, settings, args.layer, args.value_field)}")
        elif args.command == "barrios":
            from geoecon.barrios import import_barrios

            print(f"barrios: {import_barrios(conn, args.path)}")
        elif args.command == "villa-nueva":
            from geoecon.barrios import import_villa_nueva

            print(f"zonas villa nueva: {import_villa_nueva(conn, settings.idecor_wfs_url)}")
        elif args.command == "census-vm":
            from geoecon.indec import import_zones, prepare_san_martin

            source = Path("/data/raw/radios-censales-2022.csv")
            target = Path("/data/raw/san-martin-2022.geojson")
            prepare_san_martin(source, target)
            print(
                "zonas: "
                + str(
                    import_zones(
                        conn,
                        target,
                        "codigo",
                        "poblacion",
                        None,
                        "nombre",
                    )
                )
            )
        elif args.command == "indec":
            from geoecon.indec import import_zones

            print(
                "zonas: "
                + str(
                    import_zones(
                        conn,
                        args.path,
                        args.id_field,
                        args.population_field,
                        args.households_field,
                        args.name_field,
                    )
                )
            )
        elif args.command == "arca-csv":
            from geoecon.arca import link_csv

            linked, skipped = link_csv(conn, args.path)
            print(f"vinculados: {linked}; omitidos: {skipped}")


def _selftest() -> None:
    # Solo módulos sin dependencias de red ni geo: importar geoecon.barrios
    # arrastraba httpx, shapefile, pyproj y shapely, y hacía que este comando
    # fallara en un host donde nunca se instalaron.
    from geoecon.naming import zone_name

    assert zone_name("Rural Intensiva de PequeÃ±a Escala") == "Rural Intensiva de Pequeña Escala"
    assert zone_name("Circunvalacion y RN N158") == "Circunvalacion y RN N158"
    assert zone_name("Central en Altura") == "Central en Altura"
    assert weekly_hours_from_osm("24/7") == 168
    assert weekly_hours_from_osm("Mo-Fr 09:00-18:00") == 45
    assert weekly_hours_from_osm("horario raro") is None
    assert cuit_is_valid(_sample_cuit())
    assert cuit_is_valid("20-00000000-0") is False
    print("selftest ok")


def _sample_cuit() -> str:
    body = "2012345678"
    weights = (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)
    total = sum(int(digit) * weight for digit, weight in zip(body, weights))
    difference = 11 - (total % 11)
    check = 0 if difference == 11 else 9 if difference == 10 else difference
    return f"20-12345678-{check}"


if __name__ == "__main__":
    main()
