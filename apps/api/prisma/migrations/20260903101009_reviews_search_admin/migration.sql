-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClientPlatform" AS ENUM ('IOS', 'ANDROID', 'WEB', 'UNKNOWN');

-- CreateTable
CREATE TABLE "CustomerReview" (
    "id" UUID NOT NULL,
    "merchantProductId" UUID NOT NULL,
    "productRating" SMALLINT NOT NULL,
    "merchantRating" SMALLINT NOT NULL,
    "reviewerDisplayName" VARCHAR(120),
    "title" VARCHAR(160),
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "moderatedBy" VARCHAR(180),
    "moderatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchEvent" (
    "id" UUID NOT NULL,
    "query" VARCHAR(120) NOT NULL,
    "normalizedQuery" VARCHAR(120) NOT NULL,
    "platform" "ClientPlatform" NOT NULL DEFAULT 'UNKNOWN',
    "clientVersion" VARCHAR(40),
    "anonymousIdHash" CHAR(64),
    "ipHash" CHAR(64),
    "countryCode" CHAR(2),
    "resultCount" INTEGER NOT NULL,
    "page" INTEGER NOT NULL,
    "pageSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchMerchantHit" (
    "searchEventId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchMerchantHit_pkey" PRIMARY KEY ("searchEventId","merchantId","productId")
);

-- CreateIndex
CREATE INDEX "CustomerReview_merchantProductId_status_createdAt_idx" ON "CustomerReview"("merchantProductId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerReview_status_createdAt_idx" ON "CustomerReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SearchEvent_createdAt_idx" ON "SearchEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SearchEvent_normalizedQuery_createdAt_idx" ON "SearchEvent"("normalizedQuery", "createdAt");

-- CreateIndex
CREATE INDEX "SearchEvent_platform_createdAt_idx" ON "SearchEvent"("platform", "createdAt");

-- CreateIndex
CREATE INDEX "SearchEvent_anonymousIdHash_createdAt_idx" ON "SearchEvent"("anonymousIdHash", "createdAt");

-- CreateIndex
CREATE INDEX "SearchMerchantHit_merchantId_createdAt_idx" ON "SearchMerchantHit"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchMerchantHit_productId_createdAt_idx" ON "SearchMerchantHit"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerReview" ADD CONSTRAINT "CustomerReview_merchantProductId_fkey" FOREIGN KEY ("merchantProductId") REFERENCES "MerchantProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchMerchantHit" ADD CONSTRAINT "SearchMerchantHit_searchEventId_fkey" FOREIGN KEY ("searchEventId") REFERENCES "SearchEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchMerchantHit" ADD CONSTRAINT "SearchMerchantHit_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchMerchantHit" ADD CONSTRAINT "SearchMerchantHit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
