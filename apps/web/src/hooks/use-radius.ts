"use client";

import { useEffect, useState } from "react";

import type { RadiusReport } from "@/lib/domain";

export function useRadius(center: { lat: number; lng: number }, radiusM: number) {
  const [report, setReport] = useState<RadiusReport | null>(null);
  const [loading, setLoading] = useState(false);

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

  return { report, loading };
}
