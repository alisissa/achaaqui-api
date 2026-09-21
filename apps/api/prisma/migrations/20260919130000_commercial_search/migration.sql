-- Apply manually after review. Additive; never run against production implicitly.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
ALTER TABLE "Merchant" ADD COLUMN "sponsored" boolean NOT NULL DEFAULT false,
  ADD COLUMN "highlightedBy" varchar(180);
ALTER TABLE "MerchantProduct" ADD COLUMN "salePrice" decimal(14,2),
  ADD COLUMN "saleEndsAt" timestamptz(3), ADD COLUMN "promotionText" varchar(500),
  ADD COLUMN "promotionEndsAt" timestamptz(3), ADD COLUMN "sponsored" boolean NOT NULL DEFAULT false,
  ADD COLUMN "commercialUpdatedBy" varchar(180), ADD COLUMN "highlightedBy" varchar(180),
  ADD CONSTRAINT "offer_sale_valid" CHECK ("salePrice" IS NULL OR ("salePrice" > 0 AND "salePrice" < price AND (currency <> 'PYG' OR "salePrice" = trunc("salePrice")))),
  ADD CONSTRAINT "offer_sale_expiry_pair" CHECK ("saleEndsAt" IS NULL OR "salePrice" IS NOT NULL),
  ADD CONSTRAINT "offer_promotion_expiry_pair" CHECK ("promotionEndsAt" IS NULL OR "promotionText" IS NOT NULL);
CREATE INDEX "Merchant_sponsored_idx" ON "Merchant" (sponsored) WHERE sponsored;
CREATE INDEX "MerchantProduct_sponsored_idx" ON "MerchantProduct" (sponsored) WHERE sponsored;

-- Covers manual edits, imports and older API binaries consistently. Stock-only
-- writes preserve the discount; changes to regular price/currency end it.
CREATE FUNCTION clear_changed_offer_discount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    NEW."salePrice" := NULL;
    NEW."saleEndsAt" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clear_changed_offer_discount BEFORE UPDATE OF price, currency
ON "MerchantProduct" FOR EACH ROW EXECUTE FUNCTION clear_changed_offer_discount();

ALTER TABLE "Product" ADD COLUMN "searchText" text NOT NULL DEFAULT '';
CREATE FUNCTION catalog_search_text(value text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT trim(regexp_replace(regexp_replace(regexp_replace(lower(public.unaccent(value)), '([a-z])([0-9])', '\1 \2', 'g'), '([0-9])([a-z])', '\1 \2', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;
CREATE FUNCTION refresh_product_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchText" := catalog_search_text(concat_ws(' ', NEW.name, NEW.model,
    (SELECT name FROM "Brand" WHERE id = NEW."brandId")));
  RETURN NEW;
END $$;
CREATE TRIGGER refresh_product_search_text BEFORE INSERT OR UPDATE OF name, model, "brandId"
ON "Product" FOR EACH ROW EXECUTE FUNCTION refresh_product_search_text();
CREATE FUNCTION refresh_brand_product_search_text() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Product" SET "searchText" = catalog_search_text(concat_ws(' ', name, model, NEW.name)) WHERE "brandId" = NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER refresh_brand_product_search_text AFTER UPDATE OF name ON "Brand"
FOR EACH ROW EXECUTE FUNCTION refresh_brand_product_search_text();
UPDATE "Product" p SET "searchText" = catalog_search_text(concat_ws(' ', p.name, p.model, b.name)) FROM "Brand" b WHERE b.id = p."brandId";
CREATE INDEX "Product_searchText_trgm_idx" ON "Product" USING gin ("searchText" gin_trgm_ops);
