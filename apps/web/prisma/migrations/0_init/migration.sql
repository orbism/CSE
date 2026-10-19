-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "AllowlistEntry" (
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "proof" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AllowlistEntry_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Fingerprint" (
    "tokenId" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fingerprint_pkey" PRIMARY KEY ("tokenId")
);

-- CreateTable
CREATE TABLE "Draw" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "blockNumber" BIGINT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "winners" INTEGER NOT NULL,
    "entries" INTEGER NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fingerprint_seed_key" ON "Fingerprint"("seed");

