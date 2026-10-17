import { databaseUnavailable, prisma } from "@/lib/prisma";
import type { BusinessPoint } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const category = new URL(request.url).searchParams.get("category");
  try {
    const rows = await prisma.$queryRaw<BusinessPoint[]>`
      SELECT
        b.id::text AS id,
        b.name,
        b.category,
        ST_Y(b.geom)::float8 AS lat,
        ST_X(b.geom)::float8 AS lng,
        b.rating::float8 AS rating,
        b.reviews_total AS "reviewsTotal",
        b.estimated_monthly_revenue_ars::float8 AS revenue,
        b.activity_tier AS tier,
        n.neighborhood_id AS "neighborhoodId"
      FROM businesses b
      LEFT JOIN LATERAL (
        SELECT neighborhood_id
        FROM neighborhoods
        WHERE ST_Intersects(geom, b.geom)
        ORDER BY ST_Area(geom::geography)
        LIMIT 1
      ) n ON true
      WHERE ${category}::text IS NULL OR b.category = ${category}
      ORDER BY b.name
    `;
    return Response.json(rows);
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
