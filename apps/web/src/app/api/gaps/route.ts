import { databaseUnavailable, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const category = new URL(request.url).searchParams.get("category") ?? "";
  if (!/^[a-z_]+$/.test(category)) {
    return Response.json({ error: "Rubro inválido." }, { status: 400 });
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ gaps: unknown }>>`
      SELECT cell_gaps(${category}) AS gaps
    `;
    return Response.json(rows[0]?.gaps ?? { type: "FeatureCollection", features: [] });
  } catch (error) {
    console.error(error);
    return databaseUnavailable();
  }
}
