"use client";

import type { FeatureCollection, GeoJsonProperties } from "geojson";
import { useEffect, useMemo, useRef, useState } from "react";
import { Inspector } from "@/components/inspector";
import { MapCanvas } from "@/components/map-canvas";
import {
  colorCss,
  TIER_LABEL,
  type BusinessDetail,
  type BusinessPoint,
  type Overview,
  type RadiusReport,
} from "@/lib/domain";

type ZoneProps = GeoJsonProperties & {
  shade?: number;
  density?: number | null;
  landValue?: number | null;
};

const CENTER = { lng: -63.2436, lat: -32.4103 };

interface DeskState {
  category: string;
  radiusM: number;
  query: string;
  selectedId: string | null;
  center: { lng: number; lat: number };
}

function clampRadius(value: number): number {
  if (!Number.isFinite(value)) return 500;
  const snapped = Math.round(value / 50) * 50;
  return Math.min(2000, Math.max(100, snapped));
}

function inCity(lat: number, lng: number): boolean {
  return lat <= -32.32 && lat >= -32.5 && lng >= -63.34 && lng <= -63.14;
}

function readDesk(): DeskState {
  const params = new URLSearchParams(window.location.search);
  const meters = params.get("m");
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const center = Number.isFinite(lat) && Number.isFinite(lng) && inCity(lat, lng) ? { lat, lng } : CENTER;
  return {
    category: params.get("rubro") ?? "",
    radiusM: meters == null || meters === "" ? 500 : clampRadius(Number(meters)),
    query: params.get("q") ?? "",
    selectedId: params.get("id"),
    center,
  };
}

function deskParams(state: DeskState): string {
  const params = new URLSearchParams();
  if (state.category) params.set("rubro", state.category);
  if (state.radiusM !== 500) params.set("m", String(state.radiusM));
  if (state.query.trim()) params.set("q", state.query.trim());
  if (state.selectedId) params.set("id", state.selectedId);
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
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [center, setCenter] = useState(initial.center);
  const [radiusM, setRadiusM] = useState(initial.radiusM);
  const [category, setCategory] = useState(initial.category);
  const [query, setQuery] = useState(initial.query);
  const [listOpen, setListOpen] = useState(initial.query.trim().length >= 2);
  const [showPoints, setShowPoints] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [choropleth, setChoropleth] = useState<"off" | "density" | "land">("off");
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [focusToken, setFocusToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const detailTicket = useRef(0);
  const pendingUrlId = useRef(initial.selectedId);
  const lastPushed = useRef(`${initial.category}|${initial.radiusM}|${initial.selectedId ?? ""}`);
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
    const id = pendingUrlId.current;
    if (!id || points.length === 0) return;
    const point = points.find((item) => item.id === id);
    pendingUrlId.current = null;
    if (point) openRef.current(point);
  }, [points]);

  useEffect(() => {
    const onPop = () => {
      const next = readDesk();
      lastPushed.current = `${next.category}|${next.radiusM}|${next.selectedId ?? ""}`;
      setCategory(next.category);
      setRadiusM(next.radiusM);
      setCenter(next.center);
      setQuery(next.query);
      setListOpen(next.query.trim().length >= 2);
      setSelectedId(next.selectedId);
      if (!next.selectedId) {
        setDetail(null);
        return;
      }
      const point = points.find((item) => item.id === next.selectedId);
      if (point) openRef.current(point);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [points]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const state = { category, radiusM, query, selectedId, center };
      const next = deskParams(state);
      const current = window.location.search.replace(/^\?/, "");
      if (next === current) return;
      const meaningful = `${category}|${radiusM}|${selectedId ?? ""}`;
      const url = next ? `${window.location.pathname}?${next}` : window.location.pathname;
      if (meaningful !== lastPushed.current) {
        lastPushed.current = meaningful;
        window.history.pushState(null, "", url);
      } else {
        window.history.replaceState(null, "", url);
      }
    }, 280);
    return () => window.clearTimeout(handle);
  }, [category, radiusM, query, selectedId, center]);

  function openDetail(id: string) {
    const ticket = ++detailTicket.current;
    void fetch(`/api/businesses/${id}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((json: BusinessDetail | null) => {
        if (ticket === detailTicket.current) setDetail(json);
      });
  }

  function openPoint(point: BusinessPoint) {
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

  const shadedZones = useMemo(() => shadeZones(zones, choropleth), [zones, choropleth]);
  const needle = query.trim().toLocaleLowerCase("es");
  const visiblePoints = useMemo(() => {
    return points.filter((point) => {
      if (category && point.category !== category) return false;
      if (needle.length >= 2 && !point.name.toLocaleLowerCase("es").includes(needle)) return false;
      return true;
    });
  }, [points, category, needle]);
  const matches = useMemo(() => {
    if (needle.length < 2) return [];
    return points.filter((point) => {
      if (category && point.category !== category) return false;
      return point.name.toLocaleLowerCase("es").includes(needle);
    });
  }, [points, category, needle]);
  const categories = overview ? Object.entries(overview.labels) : [];
  const legend = overview?.categories.filter((item) => item.total > 0) ?? [];
  const zoneNote =
    choropleth === "density" && overview?.zoneCount === 0
      ? "No hay radios censales cargados. La capa de habitantes queda vacía."
      : choropleth === "land" && overview?.zoneCount === 0
        ? "No hay valor de suelo cargado. La capa de VUT queda vacía."
        : null;
  const labelOf = (value: string) => overview?.labels[value] ?? value;

  return (
    <main id="mesa" tabIndex={-1} className="desk">
      <MapCanvas
        points={visiblePoints}
        zones={shadedZones}
        showPoints={showPoints}
        showHeat={showHeat}
        showZones={choropleth !== "off"}
        selectedId={selectedId}
        center={center}
        radiusM={radiusM}
        focusToken={focusToken}
        onMove={setCenter}
        onPick={openPoint}
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
          {needle.length >= 2 ? ` · ${matches.length.toLocaleString("es-AR")} coincidencias` : ""}
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
        <div className="toggles" role="group" aria-label="Capas del mapa">
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
                <span className="dot tier-dot" style={{ width: 4 + tier * 3, height: 4 + tier * 3 }} />
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
        detail={detail}
        radiusM={radiusM}
        category={category}
        loading={loading}
        booting={booting}
        dbError={dbError}
        onClose={closePoint}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    </main>
  );
}

function shadeZones(
  zones: FeatureCollection<GeoJSON.Geometry, ZoneProps>,
  mode: "off" | "density" | "land",
): FeatureCollection<GeoJSON.Geometry, ZoneProps> {
  if (mode === "off") return zones;
  const key = mode === "density" ? "density" : "landValue";
  const values = zones.features
    .map((feature) => Number(feature.properties?.[key] ?? 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const low = values[Math.floor(values.length / 3)] ?? 0;
  const high = values[Math.floor((values.length * 2) / 3)] ?? 0;
  return {
    type: "FeatureCollection" as const,
    features: zones.features.map((feature) => {
      const value = Number(feature.properties?.[key] ?? 0);
      const shade = value <= 0 ? 0 : value >= high ? 2 : value >= low ? 1 : 0;
      return { ...feature, properties: { ...feature.properties, shade } };
    }),
  };
}
