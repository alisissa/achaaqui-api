ALTER TABLE "PriceHistory"
ADD COLUMN "oldCurrency" VARCHAR(3);

UPDATE "PriceHistory"
SET "oldCurrency" = "currency"
WHERE "oldPrice" IS NOT NULL;

ALTER TABLE "MerchantProduct"
ADD CONSTRAINT "MerchantProduct_price_check"
CHECK ("price" > 0),
ADD CONSTRAINT "MerchantProduct_currency_check"
CHECK ("currency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "MerchantProduct_stockQuantity_check"
CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0);

ALTER TABLE "PriceHistory"
ADD CONSTRAINT "PriceHistory_oldPrice_check"
CHECK ("oldPrice" IS NULL OR "oldPrice" > 0),
ADD CONSTRAINT "PriceHistory_newPrice_check"
CHECK ("newPrice" > 0),
ADD CONSTRAINT "PriceHistory_currency_check"
CHECK ("currency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "PriceHistory_oldCurrency_check"
CHECK ("oldCurrency" IS NULL OR "oldCurrency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "PriceHistory_oldPrice_currency_pair_check"
CHECK (("oldPrice" IS NULL) = ("oldCurrency" IS NULL));

ALTER TABLE "ImportRow"
ADD CONSTRAINT "ImportRow_proposedPrice_check"
CHECK ("proposedPrice" IS NULL OR "proposedPrice" > 0),
ADD CONSTRAINT "ImportRow_proposedCurrency_check"
CHECK ("proposedCurrency" IS NULL OR "proposedCurrency" ~ '^[A-Z]{3}$'),
ADD CONSTRAINT "ImportRow_proposedStock_check"
CHECK ("proposedStock" IS NULL OR "proposedStock" >= 0);
