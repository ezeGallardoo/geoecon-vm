"use client";

import { Map, setWorkerUrl } from "maplibre-gl";
import { useEffect, useRef } from "react";

setWorkerUrl("/maplibre-gl-worker.js");

export function GridDemo() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new Map({
      container,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: [-63.24, -32.415],
      zoom: 12.2,
    });
    map.on("load", () => {
      map.addSource("grid", { type: "geojson", data: "/snapshot/grid.geojson" });
      map.addLayer({
        id: "grid-line",
        type: "line",
        source: "grid",
        paint: { "line-color": "#d2a15a", "line-width": 1, "line-opacity": 0.6 },
      });
    });
    return () => map.remove();
  }, []);

  return <div ref={containerRef} className="map-canvas" />;
}
