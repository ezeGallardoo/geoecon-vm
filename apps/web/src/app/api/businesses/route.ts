import { databaseUnavailable, prisma } from "@/lib/prisma";
import type { BusinessPoint } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const category = new URL(request.url).searchParams.get("category");
  try {
    const rows = await prisma.$queryRaw<BusinessPoint[]>`
      SELECT
        id::text AS id,
        name,
        category,
        ST_Y(geom)::float8 AS lat,
        ST_X(geom)::float8 AS lng,
        rating::float8 AS rating,
        reviews_total AS "reviewsTotal",
        estimated_monthly_revenue_ars::float8 AS revenue,
        activity_tier AS tier
      FROM businesses
      WHERE ${category}::text IS NULL OR category = ${category}
      ORDER BY name
    `;
    return Response.json(rows);
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
