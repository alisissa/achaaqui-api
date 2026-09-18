-- Preserves legacy merchant/product reviews. New reviews target the shared
-- product, not a merchant listing, and cannot invent a merchant rating.
ALTER TABLE "CustomerReview"
  ALTER COLUMN "merchantProductId" DROP NOT NULL,
  ALTER COLUMN "merchantRating" DROP NOT NULL,
  ADD COLUMN "productId" UUID,
  ADD COLUMN "reviewerHash" CHAR(64);

ALTER TABLE "CustomerReview"
  ADD CONSTRAINT "CustomerReview_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerReview_target_check" CHECK (
    ("merchantProductId" IS NOT NULL AND "merchantRating" IS NOT NULL
      AND "productId" IS NULL AND "reviewerHash" IS NULL)
    OR
    ("merchantProductId" IS NULL AND "merchantRating" IS NULL
      AND "productId" IS NOT NULL AND "reviewerHash" IS NOT NULL
      AND "reviewerHash" ~ '^[a-f0-9]{64}$'
      AND ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 1000))
  );

CREATE UNIQUE INDEX "CustomerReview_productId_reviewerHash_key"
  ON "CustomerReview"("productId", "reviewerHash");
CREATE INDEX "CustomerReview_productId_status_createdAt_idx"
  ON "CustomerReview"("productId", "status", "createdAt");
CREATE INDEX "CustomerReview_reviewerHash_createdAt_idx"
  ON "CustomerReview"("reviewerHash", "createdAt");
