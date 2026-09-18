-- Additive only. Apply as reviewed SQL; do not run prisma migrate.
-- Deploy compatible readers before enabling PHOTO_IMPORT_ENABLED.
ALTER TYPE "ImportSource" ADD VALUE 'PHOTO';
ALTER TYPE "PriceChangeSource" ADD VALUE 'PHOTO';
