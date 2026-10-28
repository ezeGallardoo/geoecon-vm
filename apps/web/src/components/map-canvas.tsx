"use client";

import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { FeatureCollection, Polygon } from "geojson";
import { Map, NavigationControl, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type IControl } from "maplibre-gl";

setWorkerUrl("/maplibre-gl-worker.js");
import { useEffect, useRef, useState } from "react";
import { CATEGORY_COLOR, OVERVIEW_ZOOM, circlePolygon, pointRadiusPx, type BusinessPoint, type GapCell } from "@/lib/domain";
import { LAND_STOPS, POP_STOPS, formatLandUsd, landUsd } from "@/lib/land";

type ZoneCollection = FeatureCollection;

export interface ZoneTip {
  id: string;
  name: string;
  city: string;
  landValue: number | null;
  population: number;
}

interface MapCanvasProps {
  points: BusinessPoint[];
  zones: ZoneCollection;
  showPoints: boolean;
  showHeat: boolean;
  showZones: boolean;
  zoneMode: "off" | "density" | "land";
  onHoverZone: (zone: ZoneTip | null) => void;
  selectedId: string | null;
  center: { lng: number; lat: number };
  radiusM: number;
  focusToken: number;
  frameToken: number;
  frameZoom: number;
  frameBounds: [[number, number], [number, number]] | null;
  gaps: FeatureCollection<Polygon, GapCell>;
  showRadius: boolean;
  onPick: (point: BusinessPoint) => void;
  onMove: (center: { lng: number; lat: number }) => void;
  onToggleRadius: () => void;
}

const EMPTY: ZoneCollection = { type: "FeatureCollection", features: [] };

export function MapCanvas({
  points,
  zones,
  showPoints,
  showHeat,
  showZones,
  zoneMode,
  onHoverZone,
  selectedId,
  center,
  radiusM,
  focusToken,
  frameToken,
  frameZoom,
  frameBounds,
  gaps,
  showRadius,
  onPick,
  onMove,
  onToggleRadius,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startCenter = useRef(center);
  const centerRef = useRef(center);
  centerRef.current = center;
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);
  // Zoom redondeado al entero: el tamaño del punto depende del zoom, pero solo
  // hace falta recalcular cuando cambia de entero. Redondear evita reconstruir
  // las capas en cada frame de un zoom con la rueda.
  const [zoomStep, setZoomStep] = useState(OVERVIEW_ZOOM);
  const pickRef = useRef(onPick);
  const moveRef = useRef(onMove);
  const toggleRadiusRef = useRef(onToggleRadius);
  const hoverZoneRef = useRef(onHoverZone);
  const zoneModeRef = useRef(zoneMode);
  const radiusRef = useRef(radiusM);
  hoverZoneRef.current = onHoverZone;
  zoneModeRef.current = zoneMode;
  pickRef.current = onPick;
  moveRef.current = onMove;
  toggleRadiusRef.current = onToggleRadius;
  radiusRef.current = radiusM;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [startCenter.current.lng, startCenter.current.lat],
      zoom: 13,
      maxBounds: [
        [-63.36, -32.56],
        [-63.14, -32.32],
      ],
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-left");
    // interleaved: false es obligatorio con MapLibre 6: el modo interleaved de
    // deck.gl 9.4 lee `map.transform.height` y el transform interno cambió en
    // MapLibre 5+. Con interleaved:true la app revienta con
    // "undefined is not an object (evaluating 'map.transform.height')".
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });
    map.addControl(overlay as unknown as IControl);
    let moveTimer: number | undefined;
    let lastInsideAt = 0;
    let toggledAt = 0;
    const toggleCircle = () => {
      const now = Date.now();
      if (now - toggledAt < 450) return;
      toggledAt = now;
      if (moveTimer) window.clearTimeout(moveTimer);
      moveTimer = undefined;
      lastInsideAt = 0;
      toggleRadiusRef.current();
    };
    map.on("click", (event) => {
      if (zoneModeRef.current !== "off") {
        const zoneHits = map.queryRenderedFeatures([event.point.x, event.point.y], { layers: ["zones-fill"] });
        const props = zoneHits[0]?.properties as Record<string, unknown> | undefined;
        const landValue = Number(props?.landValue ?? 0);
        const showTip = zoneModeRef.current === "density" || landValue > 0;
        if (props && showTip) {
          hoverZoneRef.current({
            id: String(props.zoneId ?? props.name ?? ""),
            name: String(props.name ?? "Zona"),
            city: String(props.city ?? ""),
            landValue,
            population: Number(props.population ?? 0),
          });
        }
      }
      const picked = overlay.pickObject({ x: event.point.x, y: event.point.y, radius: 12 });
      if (picked?.object) {
        if (moveTimer) window.clearTimeout(moveTimer);
        lastInsideAt = 0;
        pickRef.current(picked.object as BusinessPoint);
        return;
      }
      const point = { lng: event.lngLat.lng, lat: event.lngLat.lat };
      if (moveTimer) window.clearTimeout(moveTimer);
      if (insideCircle(point, centerRef.current, radiusRef.current)) {
        const now = Date.now();
        if (now - lastInsideAt < 400) {
          toggleCircle();
          return;
        }
        lastInsideAt = now;
        moveTimer = window.setTimeout(() => {
          moveTimer = undefined;
          moveRef.current(point);
        }, 320);
        return;
      }
      lastInsideAt = 0;
      moveRef.current(point);
    });
    map.on("dblclick", (event) => {
      const point = { lng: event.lngLat.lng, lat: event.lngLat.lat };
      if (!insideCircle(point, centerRef.current, radiusRef.current)) return;
      event.preventDefault();
      toggleCircle();
    });
    map.on("load", () => {
      map.addSource("zones", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": DENSITY_COLOR,
          "fill-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "zones-line",
        type: "line",
        source: "zones",
        paint: { "line-color": "#e7c27a", "line-opacity": 0.55, "line-width": 1 },
      });
      map.addLayer({
        id: "zones-label",
        type: "symbol",
        source: "zones",
        minzoom: 11,
        layout: {
          "text-field": ["step", ["zoom"], ["get", "landLabel"], 14.5, ["get", "landLabelFull"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10.5, 16, 13],
          "text-line-height": 1.15,
          "text-anchor": "center",
          "text-justify": "center",
          "text-allow-overlap": false,
          "text-padding": 2,
          "symbol-sort-key": ["to-number", ["get", "landValue"], 0],
          visibility: "none",
        },
        paint: {
          "text-color": "#f6edd8",
          "text-halo-color": "#121816",
          "text-halo-width": 1,
        },
      });
      let hoverId = "";
      const readZone = (event: { point: { x: number; y: number } }) => {
        if (zoneModeRef.current === "off") {
          if (hoverId) {
            hoverId = "";
            hoverZoneRef.current(null);
          }
          map.getCanvas().style.cursor = "";
          return;
        }
        const hits = map.queryRenderedFeatures([event.point.x, event.point.y], { layers: ["zones-fill"] });
        const props = hits[0]?.properties as Record<string, unknown> | undefined;
        const landValue = Number(props?.landValue ?? 0);
        if (!props || (zoneModeRef.current === "land" && landValue <= 0)) {
          if (hoverId) {
            hoverId = "";
            hoverZoneRef.current(null);
          }
          map.getCanvas().style.cursor = "";
          return;
        }
        const id = String(props.zoneId ?? props.name ?? "");
        map.getCanvas().style.cursor = "crosshair";
        if (id === hoverId) return;
        hoverId = id;
        hoverZoneRef.current({
          id,
          name: String(props.name ?? "Zona"),
          city: String(props.city ?? ""),
          landValue: landValue > 0 ? landValue : null,
          population: Number(props.population ?? 0),
        });
      };
      map.on("mousemove", readZone);
      map.on("mouseout", () => {
        hoverId = "";
        hoverZoneRef.current(null);
        map.getCanvas().style.cursor = "";
      });
      map.addSource("gaps", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "gaps-fill",
        type: "fill",
        source: "gaps",
        paint: { "fill-color": "#c4893a", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "gaps-line",
        type: "line",
        source: "gaps",
        paint: { "line-color": "#e7c27a", "line-width": 1.5 },
      });
      map.addSource("radius", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "radius",
        paint: { "fill-color": "#d2a15a", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "radius-line",
        type: "line",
        source: "radius",
        paint: { "line-color": "#e7c27a", "line-width": 1.6 },
      });
      mapRef.current = map;
      overlayRef.current = overlay;
      map.resize();
      setReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    // No usar map.isStyleLoaded(): justo después de "load" da false mientras las
    // fuentes GeoJSON recién agregadas cargan, y si los datos ya llegaron el
    // efecto no vuelve a correr y el mapa queda vacío.
    if (!ready || !map || !overlay) return;

    // El tamaño del punto depende del zoom, así que hay que reconstruir la capa
    // cuando este cambia. Se redondea al entero y setState baila si el valor no
    // cambió, así que un zoom con la rueda no rehace las capas en cada frame.
    const onZoom = () => {
      const step = Math.round(map.getZoom());
      setZoomStep((prev) => (prev === step ? prev : step));
    };
    map.on("zoom", onZoom);
    onZoom();

    const zoneSource = map.getSource("zones") as GeoJSONSource | undefined;
    zoneSource?.setData(showZones ? labelZones(zones) : EMPTY);
    const zoneVisibility = showZones ? "visible" : "none";
    map.setLayoutProperty("zones-fill", "visibility", zoneVisibility);
    map.setLayoutProperty("zones-line", "visibility", zoneVisibility);
    map.setLayoutProperty("zones-label", "visibility", showZones && zoneMode !== "off" ? "visible" : "none");
    map.setLayoutProperty("zones-label", "text-field", zoneMode === "density" ? POP_LABEL_FIELD : LAND_LABEL_FIELD);
    map.setLayoutProperty(
      "zones-label",
      "symbol-sort-key",
      zoneMode === "density" ? POP_SORT : LAND_SORT,
    );
    map.setPaintProperty("zones-fill", "fill-color", zoneMode === "density" ? DENSITY_COLOR : LAND_COLOR);
    map.setPaintProperty("zones-fill", "fill-opacity", zoneMode === "density" ? DENSITY_OPACITY : LAND_OPACITY);
    map.setPaintProperty("zones-line", "line-color", "#e7c27a");
    map.setPaintProperty("zones-line", "line-opacity", 0.55);
    map.setPaintProperty("zones-line", "line-width", 1);
    map.setPaintProperty("gaps-line", "line-width", 1);
    map.setPaintProperty("radius-line", "line-width", 1);
    map.setPaintProperty("gaps-fill", "fill-opacity", zoneMode === "land" ? 0.08 : 0.16);

    const gapSource = map.getSource("gaps") as GeoJSONSource | undefined;
    gapSource?.setData(gaps);

    const radiusSource = map.getSource("radius") as GeoJSONSource | undefined;
    radiusSource?.setData(
      showRadius
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [circlePolygon(center.lng, center.lat, radiusM)] },
              },
            ],
          }
        : EMPTY,
    );
    map.setLayoutProperty("radius-fill", "visibility", showRadius ? "visible" : "none");
    map.setLayoutProperty("radius-line", "visibility", showRadius ? "visible" : "none");

    overlay.setProps({
      layers: [
        new HeatmapLayer<BusinessPoint>({
          id: "heat",
          data: points,
          visible: showHeat,
          getPosition: (point) => [point.lng, point.lat],
          getWeight: 1,
          radiusPixels: 28,
          intensity: 1,
          threshold: 0.08,
          colorRange: [
            [28, 48, 42, 20],
            [70, 120, 90, 90],
            [210, 170, 90, 120],
            [224, 122, 61, 150],
            [176, 64, 48, 170],
          ],
        }),
        new ScatterplotLayer<BusinessPoint>({
          id: "points",
          data: points,
          visible: showPoints,
          pickable: true,
          stroked: true,
          filled: true,
          // El radio se calcula en píxeles a partir del zoom: el punto se achica al
          // alejar y se agranda al acercar, en vez de tener siempre el mismo
          // tamaño de pantalla. Eso es lo que evita que los 1.200 comercios del
          // centro de Villa María se solapen en una mancha.
          //
          // Por qué no usar radiusMinPixels de deck.gl: el recorte sería global
          // y al alejar los cinco tiers caerían todos al mismo mínimo,
          // perdiéndose la lectura del tamaño justo en la vista general, que es
          // donde más se usa. El factor va acá, no ahí.
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          getPosition: (point) => [point.lng, point.lat],
          getRadius: (point) => pointRadiusPx(point.tier, zoomStep),
          getFillColor: (point) =>
            CATEGORY_COLOR[point.category] ?? CATEGORY_COLOR.otro,
          // Halo: sin un contorno claro el punto se pierde contra las calles
          // del basemap, que también son líneas finas.
          getLineColor: (point) =>
            point.id === selectedId
              ? [255, 248, 232, 255]
              : point.tier >= 4
                ? [255, 240, 214, 150]
                : [8, 12, 10, 210],
          getLineWidth: (point) => (point.id === selectedId ? 2.4 : point.tier >= 4 ? 1.3 : 1),
        }),
      ],
    });
    return () => {
      map.off("zoom", onZoom);
    };
  }, [ready, zoomStep, points, zones, showPoints, showHeat, showZones, zoneMode, selectedId, center, radiusM, gaps, showRadius]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || focusToken === 0) return;
    const next = centerRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.easeTo({
      center: [next.lng, next.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: reduce ? 0 : 280,
    });
  }, [focusToken, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || frameToken === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (frameBounds) {
      const narrow = map.getContainer().clientWidth < 860;
      map.fitBounds(frameBounds, {
        padding: narrow
          ? { top: 24, bottom: 24, left: 16, right: 16 }
          : { top: 40, bottom: 48, left: 48, right: 400 },
        duration: reduce ? 0 : 450,
        maxZoom: 14,
      });
      return;
    }
    const next = centerRef.current;
    map.easeTo({
      center: [next.lng, next.lat],
      zoom: frameZoom,
      duration: reduce ? 0 : 400,
    });
  }, [frameToken, frameZoom, frameBounds, ready]);

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      role="region"
      aria-label="Mapa de Villa María y Villa Nueva. Elegí un comercio desde el buscador para centrarlo con el teclado."
    />
  );
}

const POP_INPUT = ["to-number", ["get", "population"], 0] as ExpressionSpecification;
const LAND_INPUT = ["to-number", ["get", "landValue"], 0] as ExpressionSpecification;

const DENSITY_COLOR = [
  "case",
  ["<=", POP_INPUT, 0],
  "rgba(0,0,0,0)",
  ["interpolate", ["linear"], POP_INPUT, ...POP_STOPS.flatMap((stop) => [stop.population, stop.color])],
] as ExpressionSpecification;

const DENSITY_OPACITY = [
  "case",
  ["<=", POP_INPUT, 0],
  0,
  ["interpolate", ["linear"], POP_INPUT, ...POP_STOPS.flatMap((stop) => [stop.population, stop.opacity])],
] as ExpressionSpecification;

const LAND_LABEL_FIELD = ["step", ["zoom"], ["get", "landLabel"], 14.5, ["get", "landLabelFull"]] as ExpressionSpecification;
const POP_LABEL_FIELD = ["step", ["zoom"], ["get", "popLabel"], 14.5, ["get", "popLabelFull"]] as ExpressionSpecification;
const LAND_SORT = ["to-number", ["get", "landValue"], 0] as ExpressionSpecification;
const POP_SORT = ["to-number", ["get", "population"], 0] as ExpressionSpecification;

const LAND_COLOR = [
  "case",
  ["<=", LAND_INPUT, 0],
  "rgba(0,0,0,0)",
  ["interpolate", ["linear"], LAND_INPUT, ...LAND_STOPS.flatMap((stop) => [stop.pesos, stop.color])],
] as ExpressionSpecification;

const LAND_OPACITY = [
  "case",
  ["<=", LAND_INPUT, 0],
  0,
  ["interpolate", ["linear"], LAND_INPUT, ...LAND_STOPS.flatMap((stop) => [stop.pesos, stop.opacity])],
] as ExpressionSpecification;

function labelZones(collection: ZoneCollection): ZoneCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => {
      const props = feature.properties as { landValue?: number | null; name?: string; population?: number | null } | null;
      const value = Number(props?.landValue ?? 0);
      const population = Number(props?.population ?? 0);
      const name = String(props?.name ?? "Barrio");
      const shortPrice = value > 0 ? `US$ ${landUsd(value).toLocaleString("es-AR")}` : "";
      const fullPrice = value > 0 ? formatLandUsd(value) : "";
      const shortPop = population > 0 ? population.toLocaleString("es-AR") : "";
      const fullPop = population > 0 ? `${population.toLocaleString("es-AR")} hab.` : "";
      return {
        ...feature,
        properties: {
          ...feature.properties,
          landShort: shortPrice,
          landFull: fullPrice,
          landLabel: value > 0 ? `${name}\n${shortPrice}` : name,
          landLabelFull: value > 0 ? `${name}\n${fullPrice}` : name,
          popLabel: population > 0 ? `${name}\n${shortPop}` : name,
          popLabelFull: population > 0 ? `${name}\n${fullPop}` : name,
        },
      };
    }),
  };
}

function insideCircle(
  point: { lng: number; lat: number },
  center: { lng: number; lat: number },
  radiusM: number,
): boolean {
  const latRad = (center.lat * Math.PI) / 180;
  const north = (point.lat - center.lat) * 110540;
  const east = (point.lng - center.lng) * 111320 * Math.cos(latRad);
  return Math.hypot(north, east) <= radiusM;
}
