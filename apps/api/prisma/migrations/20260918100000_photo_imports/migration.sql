-- Additive only. Apply as reviewed SQL; do not run prisma migrate.
-- Deploy compatible readers before enabling PHOTO_IMPORT_ENABLED.
-- Run these statements in autocommit mode before any statement uses PHOTO.
ALTER TYPE "ImportSource" ADD VALUE IF NOT EXISTS 'PHOTO';
ALTER TYPE "PriceChangeSource" ADD VALUE IF NOT EXISTS 'PHOTO';
