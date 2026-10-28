"use client";

import type { FeatureCollection, GeoJsonProperties } from "geojson";
import dynamic from "next/dynamic";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Inspector } from "@/components/inspector";
import type { ZoneTip } from "@/components/map-canvas";
import { useGaps } from "@/hooks/use-gaps";
import { CENTER, VILLA_NUEVA, placeOf, readDesk, useDeskUrl } from "@/hooks/use-desk-url";
import { useRadius } from "@/hooks/use-radius";

const MapCanvas = dynamic(() => import("@/components/map-canvas").then((mod) => mod.MapCanvas), {
  ssr: false,
  loading: () => <div className="map-canvas" aria-hidden="true" />,
});
import {
  colorCss,
  OVERVIEW_ZOOM,
  pointRadiusPx,
  TIER_LABEL,
  type BusinessDetail,
  type BusinessPoint,
  type GapCell,
  type Overview,
  type TierScale,
} from "@/lib/domain";
import { LAND_STOPS, POP_STOPS, USD_ARS, formatLandUsd, landUsd } from "@/lib/land";

type ZoneProps = GeoJsonProperties & {
  shade?: number;
  density?: number | null;
  landValue?: number | null;
  city?: string;
};

type CityBounds = [[number, number], [number, number]];

// Si /api/overview todavía no respondió, la leyenda no inventa una escala: los
// cinco niveles quedan sin rango ni conteo hasta que lleguen los datos.
const TIER_FALLBACK: TierScale[] = [1, 2, 3, 4, 5].map((tier) => ({
  tier,
  label: TIER_LABEL[tier],
  min: 0,
  total: 0,
}));

/** "hasta 1,5 M" o "desde 6 M". El techo de un tier es el piso del siguiente. */
function tierRange(item: TierScale, next: TierScale | undefined): string {
  if (item.total === 0) return "—";
  const compact = (value: number) =>
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)} M`
      : `${Math.round(value / 1000)} k`;
  return item.tier === 1 ? `hasta ${compact(next?.min ?? 0)}` : `desde ${compact(item.min)}`;
}

function zonePlace(properties: { city?: string } | null | undefined): "vm" | "vn" {
  return properties?.city === "Villa Nueva" ? "vn" : "vm";
}

function extentOf(features: Array<{ geometry: GeoJSON.Geometry }>): CityBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      west = Math.min(west, coords[0]);
      east = Math.max(east, coords[0]);
      south = Math.min(south, coords[1]);
      north = Math.max(north, coords[1]);
      return;
    }
    for (const child of coords) walk(child);
  };
  for (const feature of features) walk((feature.geometry as { coordinates?: unknown }).coordinates);
  if (!Number.isFinite(west) || east - west < 0.0001 || north - south < 0.0001) return null;
  return [
    [west, south],
    [east, north],
  ];
}

function ringContains(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const x1 = ring[index][0];
    const y1 = ring[index][1];
    const x2 = ring[previous][0];
    const y2 = ring[previous][1];
    const crosses = y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonContains(rings: number[][][], lng: number, lat: number): boolean {
  if (rings.length === 0 || !ringContains(rings[0], lng, lat)) return false;
  for (let hole = 1; hole < rings.length; hole += 1) {
    if (ringContains(rings[hole], lng, lat)) return false;
  }
  return true;
}

function geometryContains(geometry: GeoJSON.Geometry | null | undefined, lng: number, lat: number): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return polygonContains(geometry.coordinates, lng, lat);
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => polygonContains(polygon, lng, lat));
  }
  return false;
}

function inFeatures(features: Array<{ geometry: GeoJSON.Geometry }>, lng: number, lat: number): boolean {
  return features.some((feature) => geometryContains(feature.geometry, lng, lat));
}

export function Visor() {
  const initial = useState(readDesk)[0];
  const [points, setPoints] = useState<BusinessPoint[]>([]);
  const [zones, setZones] = useState<FeatureCollection<GeoJSON.Geometry, ZoneProps>>({
    type: "FeatureCollection",
    features: [],
  });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [center, setCenter] = useState(initial.center);
  const [radiusM, setRadiusM] = useState(initial.radiusM);
  const [category, setCategory] = useState(initial.category);
  const [query, setQuery] = useState(initial.query);
  const [listOpen, setListOpen] = useState(initial.query.trim().length >= 2);
  const [showPoints, setShowPoints] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [showRadius, setShowRadius] = useState(true);
  const [zoneTip, setZoneTip] = useState<ZoneTip | null>(null);
  const [choropleth, setChoropleth] = useState<"off" | "density" | "land">(initial.choropleth);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [focusToken, setFocusToken] = useState(0);
  const [frameToken, setFrameToken] = useState(0);
  const [frameBounds, setFrameBounds] = useState<CityBounds | null>(null);
  const [place, setPlace] = useState<"vm" | "vn" | null>(initial.place);
  const framed = useRef(false);
  const [booting, setBooting] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const detailTicket = useRef(0);
  const pendingUrlId = useRef(initial.selectedId);
  const openRef = useRef<(point: BusinessPoint) => void>(() => {});
  const { report, loading } = useRadius(center, radiusM);
  const gaps = useGaps(category);
  useDeskUrl(
    { category, radiusM, query, selectedId, center, place: place ?? "vm", choropleth },
    (next) => {
      setCategory(next.category);
      setRadiusM(next.radiusM);
      setCenter(next.center);
      setQuery(next.query);
      setListOpen(next.query.trim().length >= 2);
      setSelectedId(next.selectedId);
      setPlace(next.place);
      setChoropleth(next.choropleth);
      if (!next.selectedId) {
        const bounds = extentOf(zones.features.filter((feature) => zonePlace(feature.properties) === next.place));
        if (bounds) {
          setFrameBounds(bounds);
          setFrameToken((value) => value + 1);
        }
        setDetail(null);
        return;
      }
      const point = points.find((item) => item.id === next.selectedId);
      if (point) openRef.current(point);
    },
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBooting(true);
      try {
        const [businessResponse, zoneResponse, overviewResponse] = await Promise.all([
          fetch("/api/businesses"),
          fetch("/api/zones"),
          fetch("/api/overview"),
        ]);
        if (!businessResponse.ok || !zoneResponse.ok || !overviewResponse.ok) {
          throw new Error("base");
        }
        const [businessJson, zoneJson, overviewJson] = await Promise.all([
          businessResponse.json(),
          zoneResponse.json(),
          overviewResponse.json(),
        ]);
        if (cancelled) return;
        setPoints(businessJson);
        setZones(zoneJson);
        setOverview(overviewJson);
        setDbError(null);
      } catch {
        if (!cancelled) setDbError("No hay conexión con PostGIS. El mapa sigue centrado en el ejido.");
      } finally {
        if (!cancelled) setBooting(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const id = pendingUrlId.current;
    if (!id || points.length === 0) return;
    const point = points.find((item) => item.id === id);
    pendingUrlId.current = null;
    if (point) openRef.current(point);
  }, [points]);

  function openDetail(id: string) {
    const ticket = ++detailTicket.current;
    void fetch(`/api/businesses/${id}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: BusinessDetail | null) => {
        if (ticket === detailTicket.current) setDetail(json);
      });
  }

  function openPoint(point: BusinessPoint) {
    const found = zones.features.find(
      (feature) => String(feature.properties?.zoneId ?? "") === point.neighborhoodId,
    );
    if (found) setPlace(zonePlace(found.properties));
    setSelectedId(point.id);
    setCenter({ lat: point.lat, lng: point.lng });
    setFocusToken((value) => value + 1);
    setListOpen(false);
    openDetail(point.id);
  }
  openRef.current = openPoint;

  function closePoint() {
    detailTicket.current += 1;
    setSelectedId(null);
    setDetail(null);
  }

  function focusCell(cell: GapCell) {
    setCenter({ lat: cell.lat, lng: cell.lng });
    setFocusToken((value) => value + 1);
  }

  function showCity(next: "vm" | "vn") {
    setPlace(next);
    setZoneTip(null);
    setCenter(next === "vn" ? VILLA_NUEVA : CENTER);
    const bounds = extentOf(zones.features.filter((feature) => zonePlace(feature.properties) === next));
    setFrameBounds(bounds);
    setFrameToken((value) => value + 1);
  }

  useEffect(() => {
    if (framed.current || zones.features.length === 0 || placeOf(initial.center) == null) return;
    const bounds = extentOf(zones.features.filter((feature) => zonePlace(feature.properties) === (place ?? "vm")));
    if (!bounds) return;
    framed.current = true;
    if ((place ?? "vm") === "vn" && placeOf(initial.center) !== "vn") setCenter(VILLA_NUEVA);
    setFrameBounds(bounds);
    setFrameToken((value) => value + 1);
  }, [zones, place, initial.center]);

  useEffect(() => {
    if (choropleth === "off") setZoneTip(null);
  }, [choropleth]);
  const needle = query.trim().toLocaleLowerCase("es");
  const cityFeatures = useMemo(
    () => zones.features.filter((feature) => zonePlace(feature.properties) === (place ?? "vm")),
    [zones, place],
  );
  const cityZones = useMemo(
    () => ({ type: "FeatureCollection" as const, features: cityFeatures }),
    [cityFeatures],
  );
  // PostGIS ya resolvió en /api/businesses a qué barrio pertenece cada punto,
  // así que acá alcanza con una consulta al Set en vez de ray casting por punto.
  const cityZoneIds = useMemo(
    () => new Set(cityFeatures.map((feature) => String(feature.properties?.zoneId ?? ""))),
    [cityFeatures],
  );
  const insideCity = useMemo(() => {
    const ids = new Set<string>();
    if (cityFeatures.length === 0) return ids;
    for (const point of points) {
      if (point.neighborhoodId && cityZoneIds.has(point.neighborhoodId)) ids.add(point.id);
    }
    return ids;
  }, [points, cityFeatures.length, cityZoneIds]);
  const censusPopulation = useMemo(
    () => cityFeatures.reduce((sum, feature) => sum + Number(feature.properties?.population ?? 0), 0),
    [cityFeatures],
  );
  // Las gap cells son celdas de la grilla de 400 m, no puntos con barrio: no
  // traen zoneId, así que acá sigue el point-in-polygon. Son 15 celdas contra
  // los barrios de la ciudad, un costo trivial al lado del de los negocios.
  const cityGaps = useMemo(() => {
    if (cityFeatures.length === 0) return gaps;
    return {
      type: "FeatureCollection" as const,
      features: gaps.features.filter((feature) =>
        inFeatures(cityFeatures, feature.properties.lng, feature.properties.lat),
      ),
    };
  }, [gaps, cityFeatures]);
  const visiblePoints = useMemo(() => {
    const cityReady = cityFeatures.length > 0;
    return points.filter((point) => {
      if (category && point.category !== category) return false;
      if (needle.length >= 2 && !point.name.toLocaleLowerCase("es").includes(needle)) return false;
      if (cityReady && point.id !== selectedId && !insideCity.has(point.id)) return false;
      return true;
    });
  }, [points, category, needle, cityFeatures.length, insideCity, selectedId]);
  // El filtro del buscador cambia en cada tecla. Diferir los puntos deja que
  // el input responda ya, y el mapa reconstruye la capa un frame después.
  const mapPoints = useDeferredValue(visiblePoints);
  const matches = useMemo(() => {
    if (needle.length < 2) return [];
    return points.filter((point) => {
      if (category && point.category !== category) return false;
      return point.name.toLocaleLowerCase("es").includes(needle);
    });
  }, [points, category, needle]);
  const categories = overview ? Object.entries(overview.labels) : [];
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    const cityReady = cityFeatures.length > 0;
    for (const point of points) {
      if (cityReady && !insideCity.has(point.id)) continue;
      counts.set(point.category, (counts.get(point.category) ?? 0) + 1);
    }
    return (overview?.categories ?? [])
      .map((item) => ({ ...item, total: counts.get(item.category) ?? 0 }))
      .filter((item) => item.total > 0);
  }, [overview, points, cityFeatures.length, insideCity]);
  const zoneNote =
    choropleth !== "off" && zones.features.length === 0
      ? "No hay barrios cargados. La capa queda vacía."
      : null;
  const labelOf = (value: string) => overview?.labels[value] ?? value;

  return (
    <main id="mesa" tabIndex={-1} className="desk desk--rails">
      <MapCanvas
        points={mapPoints}
        zones={cityZones}
        showPoints={showPoints}
        showHeat={showHeat}
        showZones={choropleth !== "off"}
        zoneMode={choropleth}
        onHoverZone={setZoneTip}
        selectedId={selectedId}
        center={center}
        radiusM={radiusM}
        focusToken={focusToken}
        frameToken={frameToken}
        frameZoom={13}
        frameBounds={frameBounds}
        gaps={cityGaps}
        showRadius={showRadius}
        onMove={setCenter}
        onPick={openPoint}
        onToggleRadius={() => setShowRadius(!showRadius)}
      />
      <div className="tools">
        <label>
          Buscar
          <span className="search-row">
            <input
              type="search"
              name="q"
              role="combobox"
              autoComplete="off"
              spellCheck={false}
              placeholder="Nombre del comercio…"
              value={query}
              aria-autocomplete="list"
              aria-expanded={listOpen && needle.length >= 2}
              aria-controls="coincidencias"
              onChange={(event) => {
                setQuery(event.target.value);
                setListOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setListOpen(false);
                }
              }}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setListOpen(false);
                }}
              >
                Limpiar
              </button>
            ) : null}
          </span>
        </label>
        {listOpen && needle.length >= 2 ? (
          <ul id="coincidencias" className="search-results" role="listbox" aria-label="Coincidencias">
            {matches.slice(0, 8).map((point) => (
              <li key={point.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={point.id === selectedId}
                  onClick={() => openPoint(point)}
                >
                  <span>{point.name}</span>
                  <small>{labelOf(point.category)}</small>
                </button>
              </li>
            ))}
            {matches.length === 0 ? <li className="empty">Ningún comercio coincide.</li> : null}
            {matches.length > 8 ? (
              <li className="hint">Hay {matches.length.toLocaleString("es-AR")} coincidencias. Afiná el nombre.</li>
            ) : null}
          </ul>
        ) : null}
        <p className="hint">
          {visiblePoints.length.toLocaleString("es-AR")} en el mapa
          {needle.length >= 2
            ? ` · ${matches.length.toLocaleString("es-AR")} ${matches.length === 1 ? "coincidencia" : "coincidencias"}`
            : ""}
        </p>
        <label>
          Rubro
          <select name="rubro" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Todos</option>
            {categories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Radio {radiusM.toLocaleString("es-AR")} m
          <input
            type="range"
            name="radio"
            min={100}
            max={2000}
            step={50}
            value={radiusM}
            onChange={(event) => setRadiusM(Number(event.target.value))}
          />
        </label>
        <p className="hint">Doble clic dentro del círculo lo oculta o lo vuelve a mostrar.</p>
        <div className="toggles" role="group" aria-label="Ciudad">
          <button type="button" aria-pressed={place === "vm"} onClick={() => showCity("vm")}>
            Villa María
          </button>
          <button type="button" aria-pressed={place === "vn"} onClick={() => showCity("vn")}>
            Villa Nueva
          </button>
        </div>
        <p className="hint">Cada botón deja solo esa ciudad. La otra queda afuera.</p>
        <div className="toggles" role="group" aria-label="Capas del mapa">
          <button type="button" aria-pressed={showRadius} onClick={() => setShowRadius(!showRadius)}>
            Radio
          </button>
          <button type="button" aria-pressed={showPoints} onClick={() => setShowPoints(!showPoints)}>
            Puntos
          </button>
          <button type="button" aria-pressed={showHeat} onClick={() => setShowHeat(!showHeat)}>
            Calor
          </button>
          <button
            type="button"
            aria-pressed={choropleth === "density"}
            onClick={() => setChoropleth(choropleth === "density" ? "off" : "density")}
          >
            Habitantes
          </button>
          <button
            type="button"
            aria-pressed={choropleth === "land"}
            onClick={() => setChoropleth(choropleth === "land" ? "off" : "land")}
          >
            Suelo
          </button>
        </div>
        {choropleth === "land" ? (
          <div className="soil" aria-live="polite">
            <p>
              Dólares por m² de cada barrio de Villa María y de cada zona de Villa Nueva, al dólar oficial del Banco Nación ({USD_ARS.toLocaleString("es-AR")} pesos). Donde el metro es más caro, el color tiene más contraste.
            </p>
            <ul>
              {LAND_STOPS.map((stop) => (
                <li key={stop.pesos}>
                  <i style={{ background: stop.color }} />
                  US$ {landUsd(stop.pesos).toLocaleString("es-AR")}
                </li>
              ))}
            </ul>
            {zoneTip?.landValue ? (
              <p className="soil-readout">
                <strong>{zoneTip.name}</strong>
                <b>{formatLandUsd(zoneTip.landValue)}</b>
                <span>
                  {zoneTip.city ? `${zoneTip.city} · ` : ""}
                  {zoneTip.population.toLocaleString("es-AR")} hab.
                </span>
              </p>
            ) : (
              <p className="hint">
                Cada polígono lleva su nombre y el valor del suelo. En Villa Nueva las zonas salen del código urbanístico 2026: el municipio no publica barrios.
              </p>
            )}
          </div>
        ) : null}
        {choropleth === "density" ? (
          <div className="soil" aria-live="polite">
            <p>
              Censo 2022 de {place === "vn" ? "Villa Nueva" : "Villa María"}: {censusPopulation.toLocaleString("es-AR")} habitantes. Donde vive más gente, el color tiene más contraste.
            </p>
            <ul>
              {POP_STOPS.map((stop) => (
                <li key={stop.population}>
                  <i style={{ background: stop.color }} />
                  {stop.population.toLocaleString("es-AR")}
                </li>
              ))}
            </ul>
            {zoneTip ? (
              <p className="soil-readout">
                <strong>{zoneTip.name}</strong>
                <b>{zoneTip.population.toLocaleString("es-AR")} hab.</b>
                {zoneTip.city ? <span>{zoneTip.city}</span> : null}
              </p>
            ) : (
              <p className="hint">
                Cada polígono lleva su nombre y su población. En Villa Nueva las zonas salen del código urbanístico 2026: el municipio no publica barrios.
              </p>
            )}
          </div>
        ) : null}
        {zoneNote ? (
          <p className="hint" role="status">
            {zoneNote}
          </p>
        ) : null}
        <details className="legend" open>
          <summary>Leyenda</summary>
          <p className="legend-lead">
            El color es el rubro. El tamaño es el consumo potencial que el modelo de Huff
            asigna a cada local, según la población de su zona.
          </p>
          <ul className="tiers">
            {(overview?.tiers ?? TIER_FALLBACK).map((item, index, all) => (
              <li key={item.tier}>
                <span
                  className="dot tier-dot"
                  // Misma fórmula y mismo zoom que el mapa, así la leyenda no
                  // puede volver a mostrar una escala distinta a la real.
                  style={{
                    width: 2 * pointRadiusPx(item.tier, OVERVIEW_ZOOM),
                    height: 2 * pointRadiusPx(item.tier, OVERVIEW_ZOOM),
                  }}
                />
                <span className="tier-name">{item.label ?? TIER_LABEL[item.tier]}</span>
                <span className="tier-range">{tierRange(item, all[index + 1])}</span>
                <b>{item.total.toLocaleString("es-AR")}</b>
              </li>
            ))}
          </ul>
          <ul className="swatches">
            {legend.map((item) => (
              <li key={item.category}>
                <span className="dot" style={{ background: colorCss(item.category) }} />
                <span>{labelOf(item.category)}</span>
                <b>{item.total.toLocaleString("es-AR")}</b>
              </li>
            ))}
          </ul>
        </details>
      </div>
      <Inspector
        overview={overview}
        report={report}
        gaps={cityGaps}
        detail={detail}
        radiusM={radiusM}
        category={category}
        loading={loading}
        booting={booting}
        dbError={dbError}
        cityName={place === "vn" ? "Villa Nueva" : "Villa María"}
        cityBusinessCount={insideCity.size}
        censusPopulation={censusPopulation}
        onClose={closePoint}
        onRetry={() => setAttempt((value) => value + 1)}
        onFocusCell={focusCell}
      />
    </main>
  );
}

