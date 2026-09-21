CREATE TABLE "ReviewerBan" (
  "reviewerHash" CHAR(64) NOT NULL,
  "active" BOOLEAN NOT NULL,
  "revision" UUID NOT NULL,
  "updatedBy" VARCHAR(180) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReviewerBan_pkey" PRIMARY KEY ("reviewerHash"),
  CONSTRAINT "ReviewerBan_hash_check" CHECK ("reviewerHash" ~ '^[0-9a-f]{64}$')
);
