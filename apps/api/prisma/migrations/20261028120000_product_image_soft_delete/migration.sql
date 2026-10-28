-- Additive only. Apply as reviewed SQL; do not run prisma migrate.
ALTER TABLE "ProductImage"
  ADD COLUMN "deletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "deletedBy" VARCHAR(180);
