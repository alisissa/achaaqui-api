-- Apply as reviewed SQL, not Prisma migrate, during the separately approved release.
ALTER TABLE "ReviewBlock" DROP CONSTRAINT "ReviewBlock_reviewId_fkey";
ALTER TABLE "ReviewBlock" ALTER COLUMN "reviewId" DROP NOT NULL;
ALTER TABLE "ReviewBlock" ADD CONSTRAINT "ReviewBlock_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "CustomerReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReviewDeletionReceipt" (
  "id" UUID NOT NULL,
  "reviewerHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewDeletionReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewDeletionReceipt_reviewerHash_createdAt_idx" ON "ReviewDeletionReceipt"("reviewerHash", "createdAt");
CREATE INDEX "ReviewDeletionReceipt_createdAt_idx" ON "ReviewDeletionReceipt"("createdAt");
