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
  /** Barrio o zona que contiene el punto. Lo resuelve PostGIS, no el cliente. */
  neighborhoodId: string | null;
  /** Población que el modelo de Huff le asigna al local. No es un dato medido. */
  catchmentPop: number | null;
  /** Consumo potencial del catchment. NO es facturación. */
  capturedPotentialArs: number | null;
  /** true cuando el tier viene del modelo y no de reseñas reales. */
  tierFromModel: boolean;
}

export interface CategoryStat {
  category: string;
  total: number;
  avgReviews: number;
  totalRevenueArs: number;
  avgRevenueArs: number;
  inhabitantsPerBusiness: number | null;
  cityInhabitantsPerBusiness: number | null;
  coverage: number | null;
  gap: "hueco" | "pareja" | "saturado" | null;
  potentialConsumptionArs: number | null;
}

export interface GapCell {
  cellId: number;
  lat: number;
  lng: number;
  population: number;
  businessCount: number;
  coverage: number | null;
  gap: "hueco" | "pareja" | "saturado" | null;
  opportunity: number | null;
  landCoef: number;
  potentialConsumptionArs: number;
}

export interface RadiusReport {
  populationIntersected: number;
  zonesIntersected: number;
  landValueM2: number | null;
  landCoef: number | null;
  businessCount: number;
  avgRevenueArs: number | null;
  totalRevenueArs: number | null;
  categories: CategoryStat[];
  /** null cuando el punto cae fuera de todo barrio cargado. */
  cityName: string | null;
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
  catchmentPop: number | null;
  capturedPotentialArs: number | null;
  captureTier: number | null;
  revenueTier: number | null;
  tierFromModel: boolean;
  landValueM2: number | null;
  populationDensity: number | null;
  zoneName: string | null;
  source: string;
}

export interface TierScale {
  tier: number;
  label: string;
  /** Piso del rango, en pesos por mes. 0 para el tier más bajo. */
  min: number;
  total: number;
}

export interface Overview {
  businessCount: number;
  zoneCount: number;
  cellCount: number;
  avgRevenueArs: number;
  labels: Record<string, string>;
  categories: { category: string; total: number; avgRevenueArs: number }[];
  tiers: TierScale[];
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
  manual: "Carga manual",
  unknown: "Sin origen",
};

// Paleta para basemap oscuro. Las versiones anteriores usaban tonos tierra
// apagados que, sobre un mapa casi negro (#101612), caían a menos del 3% de
// contraste y los puntos se perdían. Acá la luminancia sube y el alfa queda
// arriba: el color sigue distinguiendo el rubro, pero ahora se lee.
export const CATEGORY_COLOR: Record<string, [number, number, number, number]> = {
  kiosco: [245, 205, 125, 245],
  despensa: [255, 152, 82, 245],
  almacen: [232, 168, 112, 245],
  supermercado: [252, 224, 158, 250],
  farmacia: [128, 214, 182, 245],
  ferreteria: [140, 192, 228, 245],
  corralon: [120, 200, 235, 245],
  panaderia: [243, 205, 152, 245],
  carniceria: [236, 104, 92, 245],
  verduleria: [134, 205, 124, 245],
  restaurante: [240, 134, 98, 245],
  cafeteria: [216, 172, 126, 245],
  heladeria: [246, 206, 214, 245],
  indumentaria: [214, 148, 186, 240],
  calzado: [190, 150, 122, 240],
  estacion_servicio: [198, 208, 196, 245],
  gomeria: [186, 196, 204, 245],
  taller_mecanico: [178, 204, 226, 245],
  peluqueria: [228, 162, 190, 240],
  gimnasio: [122, 186, 152, 240],
  veterinaria: [138, 202, 172, 240],
  libreria: [196, 176, 132, 240],
  casa_de_repuestos: [176, 198, 218, 245],
  distribuidora: [156, 206, 222, 245],
  industria: [186, 198, 192, 245],
  galpon: [176, 188, 182, 245],
  institucion: [196, 212, 232, 245],
  agro: [206, 222, 138, 245],
  concesionaria: [150, 186, 230, 245],
  electronica: [128, 198, 235, 245],
  muebleria: [232, 190, 148, 245],
  inmobiliaria: [226, 208, 156, 245],
  perfumeria: [238, 172, 202, 240],
  optica: [172, 218, 232, 245],
  mascotas: [212, 180, 142, 245],
  otro: [200, 200, 190, 240],
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
