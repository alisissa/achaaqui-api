-- Additive only. Apply to production only after release approval.
CREATE TABLE "MerchantUser" (
  "id" UUID NOT NULL,
  "merchantId" UUID NOT NULL,
  "username" VARCHAR(40) NOT NULL,
  "passwordHash" VARCHAR(240) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "loginAttempts" INTEGER NOT NULL DEFAULT 0,
  "attemptsResetAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" VARCHAR(180) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "MerchantUser_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MerchantUser_username_check" CHECK ("username" ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  CONSTRAINT "MerchantUser_attempts_check" CHECK ("loginAttempts" >= 0),
  CONSTRAINT "MerchantUser_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MerchantUser_merchantId_key" ON "MerchantUser"("merchantId");
CREATE UNIQUE INDEX "MerchantUser_username_key" ON "MerchantUser"("username");
CREATE TABLE "MerchantSession" (
  "tokenHash" CHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantSession_pkey" PRIMARY KEY ("tokenHash"),
  CONSTRAINT "MerchantSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MerchantUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MerchantSession_userId_expiresAt_idx" ON "MerchantSession"("userId", "expiresAt");
ALTER TABLE "MerchantProduct" ADD COLUMN "removedBy" VARCHAR(180);
