"use client";

import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { FeatureCollection } from "geojson";
import { Map, NavigationControl, setWorkerUrl, type GeoJSONSource, type IControl } from "maplibre-gl";

setWorkerUrl("/maplibre-gl-worker.js");
import { useEffect, useRef, useState } from "react";
import { CATEGORY_COLOR, circlePolygon, type BusinessPoint } from "@/lib/domain";

type ZoneCollection = FeatureCollection;

interface MapCanvasProps {
  points: BusinessPoint[];
  zones: ZoneCollection;
  showPoints: boolean;
  showHeat: boolean;
  showZones: boolean;
  selectedId: string | null;
  center: { lng: number; lat: number };
  radiusM: number;
  focusToken: number;
  onPick: (point: BusinessPoint) => void;
  onMove: (center: { lng: number; lat: number }) => void;
}

const EMPTY: ZoneCollection = { type: "FeatureCollection", features: [] };

export function MapCanvas({
  points,
  zones,
  showPoints,
  showHeat,
  showZones,
  selectedId,
  center,
  radiusM,
  focusToken,
  onPick,
  onMove,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startCenter = useRef(center);
  const centerRef = useRef(center);
  centerRef.current = center;
  const mapRef = useRef<Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);
  const pickRef = useRef(onPick);
  const moveRef = useRef(onMove);
  pickRef.current = onPick;
  moveRef.current = onMove;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [startCenter.current.lng, startCenter.current.lat],
      zoom: 13,
      maxBounds: [
        [-63.34, -32.5],
        [-63.14, -32.32],
      ],
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-left");
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });
    map.addControl(overlay as unknown as IControl);
    map.on("click", (event) => {
      const picked = overlay.pickObject({ x: event.point.x, y: event.point.y, radius: 12 });
      if (picked?.object) {
        pickRef.current(picked.object as BusinessPoint);
        return;
      }
      moveRef.current({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    });
    map.on("load", () => {
      map.addSource("zones", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "shade"],
            0,
            "#1c3330",
            1,
            "#3f6d52",
            2,
            "#c4893a",
            "#1c3330",
          ],
          "fill-opacity": 0.55,
        },
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
    if (!ready || !map || !overlay || !map.isStyleLoaded()) return;

    const zoneSource = map.getSource("zones") as GeoJSONSource | undefined;
    zoneSource?.setData(showZones ? (zones as GeoJSON.FeatureCollection) : EMPTY);
    map.setLayoutProperty("zones-fill", "visibility", showZones ? "visible" : "none");

    const radiusSource = map.getSource("radius") as GeoJSONSource | undefined;
    radiusSource?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [circlePolygon(center.lng, center.lat, radiusM)] },
        },
      ],
    });

    overlay.setProps({
      layers: [
        new HeatmapLayer<BusinessPoint>({
          id: "heat",
          data: points,
          visible: showHeat,
          getPosition: (point) => [point.lng, point.lat],
          getWeight: 1,
          radiusPixels: 42,
          intensity: 1,
          threshold: 0.08,
          colorRange: [
            [28, 48, 42, 30],
            [70, 120, 90, 140],
            [210, 170, 90, 180],
            [224, 122, 61, 210],
            [176, 64, 48, 230],
          ],
        }),
        new ScatterplotLayer<BusinessPoint>({
          id: "points",
          data: points,
          visible: showPoints,
          pickable: true,
          opacity: 0.95,
          stroked: true,
          filled: true,
          radiusUnits: "pixels",
          lineWidthUnits: "pixels",
          getPosition: (point) => [point.lng, point.lat],
          getRadius: (point) => 4 + point.tier * 2.2,
          getFillColor: (point) => CATEGORY_COLOR[point.category] ?? CATEGORY_COLOR.otro,
          getLineColor: (point) =>
            point.id === selectedId ? [239, 230, 212, 255] : [12, 16, 13, 200],
          getLineWidth: (point) => (point.id === selectedId ? 2.4 : 1),
        }),
      ],
    });
  }, [ready, points, zones, showPoints, showHeat, showZones, selectedId, center, radiusM]);

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

  return (
    <div
      ref={containerRef}
      className="map-canvas"
      role="region"
      aria-label="Mapa del ejido de Villa María. Elegí un comercio desde el buscador para centrarlo con el teclado."
    />
  );
}
