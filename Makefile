.PHONY: db osm estimate catchment refresh dev selftest test

db:
	colima start
	docker context use colima
	docker compose up -d db

osm:
	docker compose --profile tools run --rm ingest osm

estimate:
	docker compose --profile tools run --rm ingest estimate

# Modelo de Huff: catchment por comercio y tier por tamaño. Necesita que urban_zones
# estén cargados (census-vm). Sin esto el mapa muestra todo en tier 1.
catchment:
	docker compose --profile tools run --rm ingest catchment

# Todo el derivado, en orden. Es lo que hay que correr después de cargar datos.
refresh: estimate catchment

dev:
	npm --prefix apps/web run dev

selftest:
	cd services/ingest && python3 -m geoecon selftest

# Tests de la ingesta. Corren en el contenedor porque es el único lugar donde
# están psycopg y las deps del ETL, y además es el Python que se despliega.
# Necesitás `make db` arriba para los que tocan la base.
test:
	docker compose --profile tools run --rm --entrypoint sh ingest \
		-c "pip install -q -r requirements-dev.txt && python -m pytest -q"
