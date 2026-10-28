import { databaseUnavailable, prisma } from "@/lib/prisma";
import type { BusinessPoint } from "@/lib/domain";
import { invalidQuery, parseCategory } from "@/lib/query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const parsed = parseCategory(new URL(request.url).searchParams.get("category"));
  if (!parsed.ok) return invalidQuery(parsed.error);
  const category = parsed.value;
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
        b.activity_tier AS revenueTier,
        b.capture_tier AS "captureTier",
        b.catchment_pop::float8 AS "catchmentPop",
        b.captured_potential_ars::float8 AS "capturedPotentialArs",
        -- La facturación real manda si existe; si no, el tamaño según el
        -- potencial capturado de Huff.
        COALESCE(
          CASE WHEN b.estimated_monthly_revenue_ars IS NOT NULL THEN b.activity_tier END,
          b.capture_tier,
          1
        ) AS tier,
        (b.estimated_monthly_revenue_ars IS NULL AND b.capture_tier IS NOT NULL) AS "tierFromModel",
        b.neighborhood_id AS "neighborhoodId"
      FROM businesses b
      WHERE ${category}::text IS NULL OR b.category = ${category}
      ORDER BY b.name
    `;
    return Response.json(rows);
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
