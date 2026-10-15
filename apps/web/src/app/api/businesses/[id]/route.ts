import { databaseUnavailable, prisma } from "@/lib/prisma";
import type { BusinessDetail } from "@/lib/domain";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return Response.json({ error: "Identificador inválido." }, { status: 400 });
  }

  try {
    const rows = await prisma.$queryRaw<BusinessDetail[]>`
      SELECT
        b.id::text AS id,
        b.name,
        b.category,
        COALESCE(cp.label, b.category) AS label,
        b.address,
        b.phone,
        b.website,
        b.opening_hours AS "openingHours",
        b.weekly_open_hours AS "weeklyOpenHours",
        b.rating::float8 AS rating,
        b.reviews_total AS "reviewsTotal",
        b.reviews_last_90d AS "reviewsLast90d",
        b.activity_tier AS tier,
        b.estimated_monthly_revenue_ars::float8 AS revenue,
        (
          SELECT AVG(b2.estimated_monthly_revenue_ars)::float8
          FROM businesses b2
          WHERE b2.category = b.category
        ) AS "categoryAvgRevenue",
        b.cuit,
        b.legal_name AS "legalName",
        b.tax_regime AS "taxRegime",
        b.activity_code_clae AS clae,
        b.activity_started_on::text AS "activityStartedOn",
        b.bcra_entities AS "bcraEntities",
        b.bcra_worst_status AS "bcraWorstStatus",
        b.bcra_total_debt_ars::float8 AS "bcraDebtArs",
        z.land_value_m2::float8 AS "landValueM2",
        z.population_density_ha::float8 AS "populationDensity",
        z.neighborhood_name AS "zoneName",
        b.source
      FROM businesses b
      LEFT JOIN category_params cp ON cp.category = b.category
      LEFT JOIN urban_zones z ON z.zone_id = b.zone_id
      WHERE b.id = ${id}::uuid
    `;
    if (!rows[0]) {
      return Response.json({ error: "Comercio no encontrado." }, { status: 404 });
    }
    return Response.json(rows[0]);
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
