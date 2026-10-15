"use client";

import type { FeatureCollection, GeoJsonProperties, Polygon } from "geojson";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Inspector } from "@/components/inspector";
import type { ZoneTip } from "@/components/map-canvas";

const MapCanvas = dynamic(() => import("@/components/map-canvas").then((mod) => mod.MapCanvas), {
  ssr: false,
  loading: () => <div className="map-canvas" aria-hidden="true" />,
});
import {
  colorCss,
  TIER_LABEL,
  type BusinessDetail,
  type BusinessPoint,
  type GapCell,
  type Overview,
  type RadiusReport,
} from "@/lib/domain";
import { LAND_STOPS, POP_STOPS, USD_ARS, formatLandUsd, landUsd } from "@/lib/land";

type GapCollection = FeatureCollection<Polygon, GapCell>;
const EMPTY_GAPS: GapCollection = { type: "FeatureCollection", features: [] };

type ZoneProps = GeoJsonProperties & {
  shade?: number;
  density?: number | null;
  landValue?: number | null;
  city?: string;
};

type CityBounds = [[number, number], [number, number]];

const CENTER = { lng: -63.2436, lat: -32.4103 };

interface DeskState {
  category: string;
  radiusM: number;
  query: string;
  selectedId: string | null;
  center: { lng: number; lat: number };
  place: "vm" | "vn";
  choropleth: "off" | "density" | "land";
}

function clampRadius(value: number): number {
  if (!Number.isFinite(value)) return 500;
  const snapped = Math.round(value / 50) * 50;
  return Math.min(2000, Math.max(100, snapped));
}

const VILLA_NUEVA = { lng: -63.251, lat: -32.43 };

function inCity(lat: number, lng: number): boolean {
  return lat <= -32.32 && lat >= -32.56 && lng >= -63.36 && lng <= -63.14;
}

function placeOf(point: { lat: number; lng: number }): "vm" | "vn" | null {
  const villaNueva = Math.hypot(point.lat - VILLA_NUEVA.lat, point.lng - VILLA_NUEVA.lng);
  const villaMaria = Math.hypot(point.lat - CENTER.lat, point.lng - CENTER.lng);
  if (villaNueva < 0.02 && villaNueva < villaMaria) return "vn";
  if (villaMaria < 0.02) return "vm";
  return null;
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

function readDesk(): DeskState {
  const params = new URLSearchParams(window.location.search);
  const meters = params.get("m");
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const center = Number.isFinite(lat) && Number.isFinite(lng) && inCity(lat, lng) ? { lat, lng } : CENTER;
  const ciudad = params.get("ciudad");
  const capa = params.get("capa");
  return {
    category: params.get("rubro") ?? "",
    radiusM: meters == null || meters === "" ? 500 : clampRadius(Number(meters)),
    query: params.get("q") ?? "",
    selectedId: params.get("id"),
    center,
    place: ciudad === "villa-nueva" ? "vn" : ciudad === "villa-maria" ? "vm" : (placeOf(center) ?? "vm"),
    choropleth: capa === "suelo" ? "land" : capa === "habitantes" ? "density" : "off",
  };
}

function deskParams(state: DeskState): string {
  const params = new URLSearchParams();
  if (state.category) params.set("rubro", state.category);
  if (state.radiusM !== 500) params.set("m", String(state.radiusM));
  if (state.query.trim()) params.set("q", state.query.trim());
  if (state.selectedId) params.set("id", state.selectedId);
  if (state.place === "vn") params.set("ciudad", "villa-nueva");
  if (state.choropleth === "land") params.set("capa", "suelo");
  if (state.choropleth === "density") params.set("capa", "habitantes");
  const moved =
    Math.abs(state.center.lat - CENTER.lat) > 0.00001 || Math.abs(state.center.lng - CENTER.lng) > 0.00001;
  if (moved) {
    params.set("lat", state.center.lat.toFixed(5));
    params.set("lng", state.center.lng.toFixed(5));
  }
  return params.toString();
}

export function Visor() {
  const initial = useState(readDesk)[0];
  const [points, setPoints] = useState<BusinessPoint[]>([]);
  const [zones, setZones] = useState<FeatureCollection<GeoJSON.Geometry, ZoneProps>>({
    type: "FeatureCollection",
    features: [],
  });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [report, setReport] = useState<RadiusReport | null>(null);
  const [gaps, setGaps] = useState<GapCollection>(EMPTY_GAPS);
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
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const detailTicket = useRef(0);
  const pendingUrlId = useRef(initial.selectedId);
  const lastPushed = useRef(
    `${initial.category}|${initial.radiusM}|${initial.selectedId ?? ""}|${initial.place}|${initial.choropleth}`,
  );
  const openRef = useRef<(point: BusinessPoint) => void>(() => {});

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
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/radius?lat=${center.lat}&lng=${center.lng}&meters=${radiusM}`,
        );
        if (!response.ok) throw new Error("radio");
        setReport(await response.json());
      } catch {
        setReport(null);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [center, radiusM]);

  useEffect(() => {
    if (!category) {
      setGaps(EMPTY_GAPS);
      return;
    }
    let cancelled = false;
    void fetch(`/api/gaps?category=${encodeURIComponent(category)}`)
      .then((response) => (response.ok ? response.json() : EMPTY_GAPS))
      .then((json: GapCollection) => {
        if (!cancelled) setGaps(json?.type === "FeatureCollection" ? json : EMPTY_GAPS);
      })
      .catch(() => {
        if (!cancelled) setGaps(EMPTY_GAPS);
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  useEffect(() => {
    const id = pendingUrlId.current;
    if (!id || points.length === 0) return;
    const point = points.find((item) => item.id === id);
    pendingUrlId.current = null;
    if (point) openRef.current(point);
  }, [points]);

  useEffect(() => {
    const onPop = () => {
      const next = readDesk();
      lastPushed.current = `${next.category}|${next.radiusM}|${next.selectedId ?? ""}|${next.place}|${next.choropleth}`;
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
      }
      if (!next.selectedId) {
        setDetail(null);
        return;
      }
      const point = points.find((item) => item.id === next.selectedId);
      if (point) openRef.current(point);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [points, zones]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const state = { category, radiusM, query, selectedId, center, place: place ?? "vm", choropleth };
      const next = deskParams(state);
      const current = window.location.search.replace(/^\?/, "");
      if (next === current) return;
      const meaningful = `${category}|${radiusM}|${selectedId ?? ""}|${place ?? "vm"}|${choropleth}`;
      const url = next ? `${window.location.pathname}?${next}` : window.location.pathname;
      if (meaningful !== lastPushed.current) {
        lastPushed.current = meaningful;
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(null, "", url);
      }
    }, 280);
    return () => window.clearTimeout(handle);
  }, [category, radiusM, query, selectedId, center, place, choropleth]);

  function openDetail(id: string) {
    const ticket = ++detailTicket.current;
    void fetch(`/api/businesses/${id}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: BusinessDetail | null) => {
        if (ticket === detailTicket.current) setDetail(json);
      });
  }

  function openPoint(point: BusinessPoint) {
    const found = zones.features.find((feature) => geometryContains(feature.geometry, point.lng, point.lat));
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
  const insideCity = useMemo(() => {
    const ids = new Set<string>();
    if (cityFeatures.length === 0) return ids;
    for (const point of points) {
      if (inFeatures(cityFeatures, point.lng, point.lat)) ids.add(point.id);
    }
    return ids;
  }, [points, cityFeatures]);
  const censusPopulation = useMemo(
    () => cityFeatures.reduce((sum, feature) => sum + Number(feature.properties?.population ?? 0), 0),
    [cityFeatures],
  );
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
    <main id="mesa" tabIndex={-1} className="desk">
      <MapCanvas
        points={visiblePoints}
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
        onToggleRadius={() => setShowRadius((value) => !value)}
      />
      <div className="tools">
        <label>
          Buscar
          <span className="search-row">
            <input
              type="search"
              name="q"
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
          <button type="button" aria-pressed={showRadius} onClick={() => setShowRadius((value) => !value)}>
            Radio
          </button>
          <button type="button" aria-pressed={showPoints} onClick={() => setShowPoints((value) => !value)}>
            Puntos
          </button>
          <button type="button" aria-pressed={showHeat} onClick={() => setShowHeat((value) => !value)}>
            Calor
          </button>
          <button
            type="button"
            aria-pressed={choropleth === "density"}
            onClick={() => setChoropleth((value) => (value === "density" ? "off" : "density"))}
          >
            Habitantes
          </button>
          <button
            type="button"
            aria-pressed={choropleth === "land"}
            onClick={() => setChoropleth((value) => (value === "land" ? "off" : "land"))}
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
                Cada polígono lleva su nombre y el valor. Villa Nueva no publica barrios: esas zonas son el código urbanístico 2026.
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
                Cada polígono lleva su nombre y la población. Villa Nueva no publica barrios: esas zonas son el código urbanístico 2026.
              </p>
            )}
          </div>
        ) : null}
        {zoneNote ? (
          <p className="hint" role="status">
            {zoneNote}
          </p>
        ) : null}
        <details className="legend">
          <summary>Leyenda</summary>
          <p className="hint">El tamaño del punto sigue el tier. El color es el rubro.</p>
          <ul className="tiers">
            {[1, 2, 3, 4, 5].map((tier) => (
              <li key={tier}>
                <span className="dot tier-dot" style={{ width: 3 + tier * 2, height: 3 + tier * 2 }} />
                {TIER_LABEL[tier]}
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

