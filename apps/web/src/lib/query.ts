const CATEGORY = /^[a-z_]+$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const querySchema = {
  category: { pattern: CATEGORY, message: "Rubro inválido." },
  uuid: { pattern: UUID, message: "Identificador inválido." },
  radius: {
    lat: { min: -32.56, max: -32.32 },
    lng: { min: -63.36, max: -63.14 },
    meters: { min: 100, max: 2000 },
    invalid: "Parámetros inválidos.",
    outside: "El punto queda fuera de Villa María y Villa Nueva.",
    metersMessage: "El radio va de 100 a 2000 metros.",
  },
} as const;

type Failure = { ok: false; error: string };
type Success<T> = { ok: true; value: T };

export function parseCategory(raw: string | null): Success<string | null> | Failure {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (!querySchema.category.pattern.test(raw)) {
    return { ok: false, error: querySchema.category.message };
  }
  return { ok: true, value: raw };
}

export function parseUuid(id: string): Success<string> | Failure {
  if (!querySchema.uuid.pattern.test(id)) {
    return { ok: false, error: querySchema.uuid.message };
  }
  return { ok: true, value: id };
}

export function parseRadius(params: URLSearchParams): Success<{ lat: number; lng: number; meters: number }> | Failure {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const meters = Number(params.get("meters"));
  const { radius } = querySchema;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(meters)) {
    return { ok: false, error: radius.invalid };
  }
  if (lat < radius.lat.min || lat > radius.lat.max || lng < radius.lng.min || lng > radius.lng.max) {
    return { ok: false, error: radius.outside };
  }
  if (meters < radius.meters.min || meters > radius.meters.max) {
    return { ok: false, error: radius.metersMessage };
  }
  return { ok: true, value: { lat, lng, meters } };
}

export function invalidQuery(error: string) {
  return Response.json({ error }, { status: 400 });
}
