/** Venta del Banco Nación, 15 de octubre de 2026. El VUT de IDECOR queda en pesos. */
export const USD_ARS = 1535;

export const POP_STOPS = [
  { population: 500, color: "#1c302a", opacity: 0.2 },
  { population: 1400, color: "#46785a", opacity: 0.3 },
  { population: 2600, color: "#d2aa5a", opacity: 0.4 },
  { population: 3900, color: "#e07a3d", opacity: 0.5 },
  { population: 6700, color: "#b04030", opacity: 0.62 },
] as const;

export const LAND_STOPS = [
  { pesos: 34000, color: "#1c302a", opacity: 0.2 },
  { pesos: 66000, color: "#46785a", opacity: 0.3 },
  { pesos: 132000, color: "#d2aa5a", opacity: 0.4 },
  { pesos: 351000, color: "#e07a3d", opacity: 0.5 },
  { pesos: 745000, color: "#b04030", opacity: 0.62 },
] as const;

export function landUsd(pesos: number): number {
  return Math.round(pesos / USD_ARS);
}

export function formatLandUsd(pesos: number): string {
  return `US$ ${landUsd(pesos).toLocaleString("es-AR")} / m²`;
}
