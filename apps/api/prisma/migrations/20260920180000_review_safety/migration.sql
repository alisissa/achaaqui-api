-- Additive. Apply reviewed raw SQL before deploying the API. No catalog writes.
CREATE TABLE "ReviewReport" (
  "id" UUID NOT NULL PRIMARY KEY,
  "reviewId" UUID NOT NULL REFERENCES "CustomerReview"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "reporterHash" CHAR(64) NOT NULL,
  "reason" VARCHAR(20) NOT NULL CHECK ("reason" IN ('SPAM', 'ABUSE', 'OTHER')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  "resolvedBy" VARCHAR(180),
  CHECK (("resolvedAt" IS NULL) = ("resolvedBy" IS NULL))
);
CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterHash_key" ON "ReviewReport"("reviewId", "reporterHash");
CREATE INDEX "ReviewReport_reporterHash_createdAt_idx" ON "ReviewReport"("reporterHash", "createdAt");
CREATE INDEX "ReviewReport_reviewId_resolvedAt_createdAt_idx" ON "ReviewReport"("reviewId", "resolvedAt", "createdAt");
CREATE TABLE "ReviewBlock" (
  "id" UUID NOT NULL PRIMARY KEY,
  "reviewId" UUID NOT NULL REFERENCES "CustomerReview"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "blockerHash" CHAR(64) NOT NULL,
  "blockedReviewerHash" CHAR(64),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ReviewBlock_blockerHash_reviewId_key" ON "ReviewBlock"("blockerHash", "reviewId");
CREATE INDEX "ReviewBlock_reviewId_idx" ON "ReviewBlock"("reviewId");
