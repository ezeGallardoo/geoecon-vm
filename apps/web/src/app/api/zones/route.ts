import { databaseUnavailable, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ collection: { type: "FeatureCollection"; features: unknown[] } }>
    >`
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'id', zone_id,
              'geometry', ST_AsGeoJSON(geom)::jsonb,
              'properties', jsonb_build_object(
                'zoneId', zone_id,
                'name', neighborhood_name,
                'population', population,
                'households', households,
                'density', population_density_ha,
                'landValue', land_value_m2
              )
            )
          ),
          '[]'::jsonb
        )
      ) AS collection
      FROM urban_zones
    `;
    return Response.json(rows[0]?.collection ?? { type: "FeatureCollection", features: [] });
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
