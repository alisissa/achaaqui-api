import { Prisma } from '../generated/prisma/client';

// Reserved review workspace, never a real merchant. Keep its authenticated
// workflows available, but do not publish its store or test offers to customers.
// Deliberately match the exact record, not a merchant name or a "demo" prefix.
export const REVIEW_MERCHANT_ID = '6b2200cf-d7fc-5f1c-a194-69192bc128fe';
export const PUBLIC_MERCHANT_WHERE = {
  active: true,
  id: { not: REVIEW_MERCHANT_ID },
} satisfies Prisma.MerchantWhereInput;

// Preserve existing visibility for normal products, including temporarily
// offer-less ones. Hide products belonging exclusively to the review workspace.
export const PUBLIC_PRODUCT_WHERE = {
  OR: [
    { offers: { none: { merchantId: REVIEW_MERCHANT_ID } } },
    { offers: { some: { merchantId: { not: REVIEW_MERCHANT_ID } } } },
  ],
} satisfies Prisma.ProductWhereInput;

// Public SQL queries use the same product alias and eligibility as Prisma reads.
export const PUBLIC_PRODUCT_SQL = Prisma.sql`(
  NOT EXISTS (SELECT 1 FROM "MerchantProduct" review_offer WHERE review_offer."productId" = p.id AND review_offer."merchantId" = ${REVIEW_MERCHANT_ID}::uuid)
  OR EXISTS (SELECT 1 FROM "MerchantProduct" real_offer WHERE real_offer."productId" = p.id AND real_offer."merchantId" <> ${REVIEW_MERCHANT_ID}::uuid)
)`;
