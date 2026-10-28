"use client";

import { useEffect, useState } from "react";
import type { FeatureCollection, Polygon } from "geojson";

import type { GapCell } from "@/lib/domain";

export type GapCollection = FeatureCollection<Polygon, GapCell>;

export const EMPTY_GAPS: GapCollection = { type: "FeatureCollection", features: [] };

export function useGaps(category: string) {
  const [gaps, setGaps] = useState<GapCollection>(EMPTY_GAPS);

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

  return gaps;
}
