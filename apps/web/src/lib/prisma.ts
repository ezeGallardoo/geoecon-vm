import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export function databaseUnavailable() {
  return Response.json(
    { error: "La base PostGIS no respondió. Levantá el contenedor y reintentá." },
    { status: 503 },
  );
}
