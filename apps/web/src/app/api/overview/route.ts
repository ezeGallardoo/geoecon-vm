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
    const overview: Overview = {
      ...totals,
      categories,
      labels: Object.fromEntries(labels.map((row) => [row.category, row.label])),
    };
    return Response.json(overview);
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
