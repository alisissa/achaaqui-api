-- Additive only. Apply as reviewed SQL; do not run prisma migrate.
ALTER TABLE "Merchant"
  ADD COLUMN "deletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deletedBy" VARCHAR(180);
