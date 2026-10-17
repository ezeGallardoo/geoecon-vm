.PHONY: db osm estimate dev selftest test

db:
	colima start
	docker context use colima
	docker compose up -d db

osm:
	docker compose --profile tools run --rm ingest osm

estimate:
	docker compose --profile tools run --rm ingest estimate

dev:
	npm --prefix apps/web run dev

selftest:
	cd services/ingest && python3 -m geoecon selftest

# Tests de la ingesta. Los que tocan la base necesitan `make db` arriba.
test:
	cd services/ingest && python3 -m pytest -q
