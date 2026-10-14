-- Unknown is NULL, never zero or an estimated merchant price.
ALTER TABLE "MerchantProduct" ALTER COLUMN price DROP NOT NULL;
ALTER TABLE "MerchantProduct" DROP CONSTRAINT "offer_sale_valid";
ALTER TABLE "MerchantProduct" ADD CONSTRAINT "offer_sale_valid"
CHECK ("salePrice" IS NULL OR (price IS NOT NULL AND "salePrice" > 0 AND "salePrice" < price AND (currency <> 'PYG' OR "salePrice" = trunc("salePrice"))));
-- Positive-price and currency constraints remain in force. The existing
-- clear_changed_offer_discount trigger clears sales on price withdrawal.
