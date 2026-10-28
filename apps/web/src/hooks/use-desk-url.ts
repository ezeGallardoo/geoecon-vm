"use client";

import { useEffect, useRef } from "react";

export const CENTER = { lng: -63.2436, lat: -32.4103 };
export const VILLA_NUEVA = { lng: -63.251, lat: -32.43 };

export interface DeskState {
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

function inCity(lat: number, lng: number): boolean {
  return lat <= -32.32 && lat >= -32.56 && lng >= -63.36 && lng <= -63.14;
}

export function placeOf(point: { lat: number; lng: number }): "vm" | "vn" | null {
  const villaNueva = Math.hypot(point.lat - VILLA_NUEVA.lat, point.lng - VILLA_NUEVA.lng);
  const villaMaria = Math.hypot(point.lat - CENTER.lat, point.lng - CENTER.lng);
  if (villaNueva < 0.02 && villaNueva < villaMaria) return "vn";
  if (villaMaria < 0.02) return "vm";
  return null;
}

export function readDesk(): DeskState {
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

function deskKey(state: Pick<DeskState, "category" | "radiusM" | "selectedId" | "place" | "choropleth">) {
  return `${state.category}|${state.radiusM}|${state.selectedId ?? ""}|${state.place}|${state.choropleth}`;
}

export function useDeskUrl(desk: DeskState, onPop: (next: DeskState) => void) {
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;
  const lastPushed = useRef<string | null>(null);
  if (lastPushed.current == null) lastPushed.current = deskKey(desk);

  useEffect(() => {
    const onPopState = () => {
      const next = readDesk();
      lastPushed.current = deskKey(next);
      onPopRef.current(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const { category, radiusM, query, selectedId, center, place, choropleth } = desk;

  useEffect(() => {
    const state: DeskState = { category, radiusM, query, selectedId, center, place, choropleth };
    const handle = window.setTimeout(() => {
      const next = deskParams(state);
      const current = window.location.search.replace(/^\?/, "");
      if (next === current) return;
      const meaningful = deskKey(state);
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
}
