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
              'id', neighborhood_id,
              'geometry', ST_AsGeoJSON(geom)::jsonb,
              'properties', jsonb_build_object(
                'zoneId', neighborhood_id,
                'name', name,
                'population', population,
                'households', 0,
                'landValue', land_value_m2,
                'city', CASE WHEN source = 'idecor-vn' THEN 'Villa Nueva' ELSE 'Villa María' END,
                'density', CASE
                  WHEN ST_Area(geom::geography) > 0
                  THEN ROUND((population / (ST_Area(geom::geography) / 10000.0))::numeric, 4)
                  ELSE 0
                END
              )
            )
          ),
          '[]'::jsonb
        )
      ) AS collection
      FROM neighborhoods
    `;
    return Response.json(rows[0]?.collection ?? { type: "FeatureCollection", features: [] });
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
