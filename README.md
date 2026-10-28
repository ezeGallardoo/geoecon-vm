# GeoRadar

Mesa de catastro comercial para Villa María y Villa Nueva.

El mapa lee el padrón ya cargado. El cálculo del radio corre en PostGIS, no en el navegador. Cruza comercios, el censo 2022 y el valor de suelo de IDECOR para marcar dónde hay demanda que todavía no tiene local. El consumo potencial sale de un modelo de Huff. No es facturación.

![Mesa de catastro comercial, con el padrón de Villa María y el radio de 500 m](docs/mesa.png)

En esa captura Villa María muestra 1.094 comercios, 380 celdas y 92.588 habitantes del censo 2022. Dentro del radio de 500 m hay 189 comercios y 3.491 habitantes. Esos números salen del padrón cargado ese día.

## Habitantes

La capa pinta el censo 2022. Donde vive más gente, el color tiene más contraste. Villa Nueva no publica barrios: sus zonas son unidades del código urbanístico 2026.

![Capa de habitantes del censo 2022 sobre Villa María](docs/habitantes.png)

## La grilla

Cada celda mide 400 m. El mapa usa esa grilla para marcar dónde hay demanda que todavía no tiene local. `/demo` dibuja las 380 celdas de Villa María y Villa Nueva sin base de datos, y no muestra comercios ni huecos.

![Grilla de 400 m sobre Villa María y Villa Nueva](docs/grilla.png)

## Stack

| Capa | Tecnología |
|---|---|
| Base | PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4`) |
| API | Next.js 15 App Router, Route Handlers sobre `prisma.$queryRaw` |
| UI | React 19, MapLibre GL 6, deck.gl 9, Tailwind 4 |
| Ingesta | Python 3.11 (`psycopg`, `httpx`, `shapely`, `pyproj`, `pyshp`) |
| Runtime | **Colima**, no Docker Desktop |

Prisma es un espejo del esquema. La lógica espacial y de negocio vive en SQL
(`db/init/002_functions.sql`); Prisma solo transporta resultados. Para leer
geometría se usa SQL crudo, no el ORM.

## Requisitos

- **Colima** como runtime Docker. `docker context use colima` antes de cualquier compose.
- Node **20.19+** o **22.13+**. Es un requisito de dependencias transitivas: el
  proyecto no declara `engines` en `package.json`.
- Python 3.11 para correr `make selftest` en el host. El resto de la ingesta corre
  en contenedor.

## Puesta en marcha

El orden importa. `generate_vm_grid()` **lanza excepción si `businesses` ya tiene
filas** (`db/init/002_functions.sql:22-24`), así que la grilla se genera una sola
vez, al principio.

```bash
make db         # colima start + docker compose up -d db  (PostGIS en :5435)
make osm        # importa comercios de OpenStreetMap en el bbox
make estimate   # recalcula tier e ingreso estimado
make dev        # Next.js en :3000
```

## Comandos

| Comando | Qué hace |
|---|---|
| `make db` | Levanta Colima y PostGIS |
| `make osm` | Importa comercios OSM (Overpass, 3 mirrors con failover) |
| `make estimate` | Corre `recalculate_estimates()` sobre todo el padrón |
| `make dev` | Servidor de desarrollo |
| `make selftest` | Pruebas de helpers de Python, sin base ni dependencias del ETL |
| `make test` | Suite completa. Corre en el contenedor; los tests de PostGIS necesitan `make db` |

## Cambios en el esquema

`db/init/*.sql` **solo corre en la primera inicialización del contenedor**. Después
de modificar una función hay que recargarla a mano, o el cambio no llega a la base:

```bash
docker compose exec -T db psql -U geoecon -d geoecon -v ON_ERROR_STOP=1 < db/init/002_functions.sql
```

Si tocás `001_schema.sql` (columnas, índices, claves foráneas) eso **no alcanza**:
tenés que aplicar el `ALTER TABLE` sobre la base existente, o bajar y volver a
levantar el volumen.

Es una limitación conocida: no hay sistema de migraciones.

### Columnas materializadas

`businesses.neighborhood_id` guarda a qué barrio o zona pertenece cada comercio.
Lo calcula `assign_business_neighborhoods()`, que `barrios` y `villa-nueva`
llaman al terminar de cargar los polígonos.

Se materializó en vez de resolverse por geometría en cada consulta porque eso
cuesta ~120 ms sobre el padrón entero, y el visor lo pide en cada arranque. La
columna quedó **más rápida que la consulta original sin barrio**, y garantiza que
la lista y la ficha muestren siempre el mismo.

## Tests

```bash
make test
```

Los tests de base corren dentro de una transacción que se revierte al final, así
que no tocan los datos cargados. Aun así vacían `businesses`, `urban_zones` y
`neighborhoods` durante cada test para medir sobre datos sembrados y no sobre el
padrón real.

## Comandos de ingesta

Todos corren en el contenedor con el perfil `tools`:

```bash
docker compose --profile tools run --rm ingest <comando> [flags]
```

| Comando | Qué hace | Prerrequisito |
|---|---|---|
| `grid` | Regenera la grilla de 400 m | Base sin comercios |
| `osm` | Comercios desde OpenStreetMap | — |
| `estimate` | Recalcula tier e ingreso | — |
| `reclassify` | Saca de `otro` los que ya tienen rubro OSM | — |
| `census-vm` | Recorta el CSV nacional 2022 al dep. Gral. San Martín | `data/raw/radios-censales-2022.csv` |
| `idecor-layers` | Lista capas WFS que parecen tener VUT | — |
| `idecor --layer --value-field` | Carga valor de suelo | **correr `idecor-layers` primero** para descubrir el `typeName` |
| `barrios [--path]` | Barrios de la Municipalidad + VUT | **`census-vm` antes** |
| `villa-nueva` | Zonas del código urbanístico 2026 de VN | **`census-vm` antes** |
| `indec --path ...` | Radios censales en GeoJSON o Shapefile | — |
| `arca-csv --path` | Vincula CUIT desde un padrón local | CSV con `cuit,name,legal_name,tax_regime,activity_code_clae` |
| `bcra --cuit` | Consulta la Central de Deudores | CUIT ya vinculado |
| `snapshot` | Escribe la grilla de 400 m en `apps/web/public/snapshot/grid.geojson`. Si PostGIS responde, también vuelca comercios y huecos | — |

### Orden de carga recomendado

```
census-vm  →  idecor  →  barrios / villa-nueva  →  osm  →  arca-csv  →  bcra
```

La población y el VUT de barrios y zonas se **derivan** de `urban_zones`. Correrlos
al revés deja barrios con población 0.

## De dónde salen los datos

| Dato | Origen | Acceso |
|---|---|---|
| Comercios | OpenStreetMap (Overpass) | gratuito, API pública |
| Población | Censo 2022, radios censales | INDEC, CSV público |
| Valor de suelo | VUT por parcela | IDECOR WFS |
| Barrios VM | Shape municipal | datos abiertos del municipio |
| Zonas VN | Código urbanístico 2026 | IDECOR WFS |
| CUIT / régimen / CLAE | Padrón CSV local | **manual**: ARCA no expone API pública |
| Deuda y situación | Central de Deudores | BCRA, API oficial |

`data/raw/` está en `.gitignore`: los insumos pesados (CSV del censo, shapefiles) hay
que bajarlos a mano.

## Modelo de estimación

Todo el cálculo ocurre en PostGIS. El frontend solo lee.

```
revenue = MAX(tráfico, piso_fiscal, señal_crédito) × coef_zona
```

- **tráfico** = `(reseñas_90d / 13) × visitas_por_reseña × (horas / 48) × 4.345 × ticket`
- **piso_fiscal** = `tope_anual / 12 × 0.55` — **inactivo**: los topes de monotributo
  vienen en `NULL` hasta que se carguen
- **señal_crédito** = `deuda_pesos × 0.15`, solo si la situación BCRA es 1
- **coef_zona** = `valor_m2 / mediana_ciudad`, acotado a `0.75..1.45`

Sin señal suficiente, `revenue` queda en `NULL` y el tier en 1 (Micro).

Los coeficientes viven en `model_settings`, `category_params` y `activity_tiers`
(seed en `db/init/003_seed.sql`). **Son supuestos, no cifras oficiales de ARCA ni de
INDEC.** Editalos y corré `make estimate`.

La cobertura de un rubro se calcula como
`locales_en_radio × población_ciudad / (población_radio × locales_ciudad)`.
Por debajo de `0.7` se marca `hueco`, por encima de `1.4` `saturado`, y en el medio
`pareja`.

`cell_gaps()` aplica la misma lógica celda por celda sobre la grilla de 400 m y
devuelve las 15 celdas con mayor oportunidad, ponderada por el coeficiente de suelo.

## Variables de entorno

| Variable | Dónde | Default |
|---|---|---|
| `DATABASE_URL` | web (`apps/web/.env`) | `postgresql://geoecon:geoecon@localhost:5435/geoecon` |
| `DATABASE_URL` | ingesta | `postgresql://geoecon:geoecon@db:5432/geoecon` (dentro de la red de compose) |
| `BCRA_DEUDAS_URL` | ingesta | `https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/{cuit}` |
| `IDECOR_WFS_URL` | ingesta | `https://idecor-ws.mapascordoba.gob.ar/geoserver/idecor/wfs` |
| `OVERPASS_URL` | ingesta | `https://overpass-api.de/api/interpreter` |

**Ojo con esto:** Next.js corre en el host, así que su `DATABASE_URL` apunta a
`localhost:5435`. La ingesta corre en Docker, así que la suya apunta a `db:5432`.
No son intercambiables.

Usá `npm install`, no `npm ci --ignore-scripts`: el `postinstall` genera el cliente
de Prisma y copia el worker de MapLibre a `public/`. Sin eso el mapa no renderiza.

## El modelo de Huff

El mapa no muestra tamaños medidos: no hay ningún dato de ventas. Lo que muestra
es el **consumo potencial** que le asigna a cada local un modelo de gravedad de
Huff, combinando distancia y competencia dentro del rubro con el ticket del
`category_params`.

```
P(i compra en j) = (A_j / d_ij^alfa) / SUM_k (A_k / d_ik^alfa)
```

Con `A_j = 1` para todos, porque no tenemos superficie del local. Los parámetros
—exponente de decaimiento, radio máximo y distancia mínima— están en
`model_settings` y se ajustan con `assign_business_catchment()`.

Sirve para **ordenar y comparar locales entre sí**. No sirve para declarar
facturación, y la ficha del visor lo dice en pantalla. La limitation conocida:
despensa, almacén y supermercado son sustitutos pero compiten solo consigo
mismos, así que el solapamiento real está subestimado.

Cuando aparezca una señal de reseñas o fiscal, `recalculate_estimates()` calcula
la facturación real y el API prioriza ese tier sobre el del modelo.

## Demo estática

La captura de [la grilla](#la-grilla) sale de `apps/web/public/snapshot/grid.geojson`, con las mismas constantes que `generate_vm_grid()`. `python -m geoecon snapshot` regenera ese archivo. Los comercios y los huecos de demanda siguen en la mesa, con PostGIS.

## Advertencias

- El barrido de Google Maps con Playwright se sacó del código. No formaba parte
  de una versión mostrable: devolvía resultados de Córdoba capital y dependía de
  scraping.
- **El consumo potencial no es facturación.** Sale de un modelo de gravedad de
  Huff sobre la población censal y el ticket del rubro. Sirve para ordenar y
  comparar locales entre sí. No hay ningún dato de ventas con el cual validarlo.
- **Villa Nueva no publica barrios.** Sus zonas son unidades del código urbanístico
  2026, no barrios con nombre.
- `apps/web/src/lib/land.ts` tiene el dólar oficial **hardcodeado** (`USD_ARS`, con
  fecha del 15-oct-2026). Al comparar VUT de distintos años, el valor nominal en
  pesos no es comparable.

## Deuda técnica conocida

- El radio, los huecos y la URL del visor viven en `useRadius`, `useGaps` y
  `useDeskUrl`. El filtrado del mapa sigue en `visor.tsx`.
- Las APIs leen los parámetros con el esquema de `src/lib/query.ts`.
- `tax_brackets.annual_cap_ars` en `NULL`: la señal fiscal está apagada hasta que se
  carguen los topes vigentes de ARCA.
- GitHub Actions corre `make selftest` y pytest contra PostGIS.
- No hay migraciones. Ver [Cambios en el esquema](#cambios-en-el-esquema).
- La cobertura por rubro necesita que el punto caiga dentro de un barrio cargado.
  Fuera de eso, `cityName` y `coverage` vienen en `null` a propósito: es preferible
  no comparar contra un denominador inventado.