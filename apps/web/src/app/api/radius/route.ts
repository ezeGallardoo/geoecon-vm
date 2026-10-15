import { databaseUnavailable, prisma } from "@/lib/prisma";
import type { RadiusReport } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const meters = Number(params.get("meters"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(meters)) {
    return Response.json({ error: "Parámetros inválidos." }, { status: 400 });
  }
  if (lat < -32.5 || lat > -32.3 || lng < -63.35 || lng > -63.15) {
    return Response.json({ error: "El punto queda fuera de Villa María." }, { status: 400 });
  }
  if (meters < 100 || meters > 2000) {
    return Response.json({ error: "El radio va de 100 a 2000 metros." }, { status: 400 });
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ report: RadiusReport }>>`
      SELECT radius_report(${lat}, ${lng}, ${meters}) AS report
    `;
    return Response.json(rows[0]?.report ?? null);
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
