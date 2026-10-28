import { databaseUnavailable, prisma } from "@/lib/prisma";
import type { RadiusReport } from "@/lib/domain";
import { invalidQuery, parseRadius } from "@/lib/query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const parsed = parseRadius(new URL(request.url).searchParams);
  if (!parsed.ok) return invalidQuery(parsed.error);
  const { lat, lng, meters } = parsed.value;

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
