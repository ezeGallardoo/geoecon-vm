export interface BusinessPoint {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewsTotal: number;
  revenue: number | null;
  tier: number;
}

export interface CategoryStat {
  category: string;
  total: number;
  avgReviews: number;
  totalRevenueArs: number;
  avgRevenueArs: number;
  inhabitantsPerBusiness: number | null;
}

export interface RadiusReport {
  populationIntersected: number;
  zonesIntersected: number;
  businessCount: number;
  avgRevenueArs: number | null;
  totalRevenueArs: number | null;
  categories: CategoryStat[];
}

export interface BusinessDetail {
  id: string;
  name: string;
  category: string;
  label: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  weeklyOpenHours: number | null;
  rating: number | null;
  reviewsTotal: number;
  reviewsLast90d: number;
  tier: number;
  revenue: number | null;
  categoryAvgRevenue: number | null;
  cuit: string | null;
  legalName: string | null;
  taxRegime: string | null;
  clae: string | null;
  activityStartedOn: string | null;
  bcraEntities: string[] | null;
  bcraWorstStatus: number | null;
  bcraDebtArs: number | null;
  landValueM2: number | null;
  populationDensity: number | null;
  zoneName: string | null;
  source: string;
}

export interface Overview {
  businessCount: number;
  zoneCount: number;
  cellCount: number;
  avgRevenueArs: number;
  labels: Record<string, string>;
  categories: { category: string; total: number; avgRevenueArs: number }[];
}

export const TIER_LABEL: Record<number, string> = {
  1: "Micro",
  2: "Chico",
  3: "Medio",
  4: "Grande",
  5: "Mayor",
};

export const SOURCE_LABEL: Record<string, string> = {
  osm: "OpenStreetMap",
  google_maps: "Google Maps",
  manual: "Carga manual",
  unknown: "Sin origen",
};

export const CATEGORY_COLOR: Record<string, [number, number, number, number]> = {
  kiosco: [210, 161, 90, 230],
  despensa: [224, 122, 61, 230],
  almacen: [196, 122, 74, 230],
  supermercado: [232, 196, 122, 235],
  farmacia: [126, 168, 154, 230],
  ferreteria: [146, 176, 192, 230],
  corralon: [150, 176, 194, 230],
  panaderia: [214, 176, 122, 230],
  carniceria: [176, 92, 78, 230],
  verduleria: [122, 158, 96, 230],
  restaurante: [196, 108, 78, 230],
  cafeteria: [168, 132, 96, 230],
  heladeria: [232, 214, 196, 230],
  indumentaria: [168, 112, 138, 220],
  calzado: [138, 108, 92, 220],
  estacion_servicio: [168, 176, 168, 230],
  gomeria: [164, 172, 178, 230],
  taller_mecanico: [168, 176, 184, 230],
  peluqueria: [186, 140, 154, 220],
  gimnasio: [96, 128, 112, 220],
  veterinaria: [112, 148, 132, 220],
  libreria: [128, 116, 92, 220],
  casa_de_repuestos: [160, 176, 186, 230],
  distribuidora: [148, 176, 190, 230],
  industria: [156, 166, 162, 230],
  galpon: [148, 156, 152, 230],
  institucion: [176, 188, 204, 230],
  otro: [214, 206, 188, 235],
};

export function colorCss(category: string): string {
  const [red, green, blue, alpha] = CATEGORY_COLOR[category] ?? CATEGORY_COLOR.otro;
  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3)})`;
}

export function safeHttp(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 6) return null;
  return `tel:${digits}`;
}

export function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function circlePolygon(lng: number, lat: number, radiusM: number, steps = 72): number[][] {
  const latRad = (lat * Math.PI) / 180;
  const metersPerLat = 110540;
  const metersPerLng = 111320 * Math.cos(latRad);
  const ring: number[][] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    ring.push([
      lng + (Math.cos(angle) * radiusM) / metersPerLng,
      lat + (Math.sin(angle) * radiusM) / metersPerLat,
    ]);
  }
  return ring;
}
