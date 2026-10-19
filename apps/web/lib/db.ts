import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/** Set when the site has a database; the allowlist and the fingerprint index need one. */
export const HAS_DB = !!process.env.DATABASE_URL;

const g = globalThis as unknown as { __cseDb?: PrismaClient };

/** One client per process. Lazy, so a build or a local run without a database never opens a pool. */
export function db(): PrismaClient {
  if (!g.__cseDb) {
    g.__cseDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  return g.__cseDb;
}

/** Prisma's unique-violation code, the one error the allowlist route expects. */
export const UNIQUE_VIOLATION = "P2002";
