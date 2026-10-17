import { databaseUnavailable, prisma } from "@/lib/prisma";
import type { Overview } from "@/lib/domain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [totals] = await prisma.$queryRaw<
      Array<{
        businessCount: number;
        zoneCount: number;
        cellCount: number;
        avgRevenueArs: number;
      }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM businesses) AS "businessCount",
        (SELECT COUNT(*)::int FROM urban_zones) AS "zoneCount",
        (SELECT COUNT(*)::int FROM analysis_cells) AS "cellCount",
        COALESCE((SELECT AVG(estimated_monthly_revenue_ars)::float8 FROM businesses), 0) AS "avgRevenueArs"
    `;
    const categories = await prisma.$queryRaw<
      Array<{ category: string; total: number; avgRevenueArs: number }>
    >`
      SELECT
        category,
        COUNT(*)::int AS total,
        COALESCE(AVG(estimated_monthly_revenue_ars)::float8, 0) AS "avgRevenueArs"
      FROM businesses
      GROUP BY category
      ORDER BY total DESC
    `;
    const labels = await prisma.$queryRaw<Array<{ category: string; label: string }>>`
      SELECT category, label FROM category_params ORDER BY label
    `;
    // El tier del mapa sale del potencial capturado de Huff. Se manda el conteo
    // por tier y la escala para que la leyenda pueda decir cuántos hay en cada
    // uno y qué rango cubre, en vez de solo el nombre.
    const tiers = await prisma.$queryRaw<
      Array<{ tier: number; label: string; min: number; total: number }>
    >`
      SELECT
        t.tier,
        t.label,
        t.min_monthly_ars::float8 AS min,
        COUNT(b.id)::int AS total
      FROM activity_tiers t
      LEFT JOIN businesses b
        ON COALESCE(
             CASE WHEN b.estimated_monthly_revenue_ars IS NOT NULL
                  THEN b.activity_tier END,
             b.capture_tier
           ) = t.tier
      GROUP BY t.tier, t.label, t.min_monthly_ars
      ORDER BY t.min_monthly_ars
    `;
    const overview: Overview = {
      ...totals,
      categories,
      labels: Object.fromEntries(labels.map((row) => [row.category, row.label])),
      tiers,
    };
    return Response.json(overview);
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
