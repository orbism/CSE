import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next loads .env.local itself; the Prisma CLI does not. `generate` needs no
// database, so a missing DATABASE_URL only matters for migrations.
config({ path: ".env.local" });
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://unset/unset" },
});
