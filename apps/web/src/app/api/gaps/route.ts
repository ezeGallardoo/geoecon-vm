import { databaseUnavailable, prisma } from "@/lib/prisma";
import { invalidQuery, parseCategory } from "@/lib/query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const parsed = parseCategory(new URL(request.url).searchParams.get("category") ?? "");
  if (!parsed.ok || parsed.value == null) return invalidQuery(parsed.ok ? "Rubro inválido." : parsed.error);
  const category = parsed.value;

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
