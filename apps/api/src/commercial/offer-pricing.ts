import { Prisma } from '../generated/prisma/client';

export const COMMERCIAL_SELECT = {
  salePrice: true,
  saleEndsAt: true,
  promotionText: true,
  promotionEndsAt: true,
} as const;
interface PricedOffer {
  price: Prisma.Decimal;
  currency: string;
  salePrice?: Prisma.Decimal | null;
  saleEndsAt?: Date | null;
  promotionText?: string | null;
  promotionEndsAt?: Date | null;
}
export function effectivePrice(
  offer: PricedOffer,
  now = new Date(),
): Prisma.Decimal {
  return offer.salePrice &&
    offer.salePrice.greaterThan(0) &&
    offer.salePrice.lessThan(offer.price) &&
    (!offer.saleEndsAt || offer.saleEndsAt > now)
    ? offer.salePrice
    : offer.price;
}
export function publicCommercial(
  offer: PricedOffer,
  now = new Date(),
): {
  regularPrice: { amount: string; currency: string } | null;
  saleEndsAt: string | null;
  promotion: { text: string; endsAt: string | null } | null;
} {
  const discounted = !effectivePrice(offer, now).equals(offer.price);
  return {
    regularPrice: discounted
      ? { amount: offer.price.toString(), currency: offer.currency }
      : null,
    saleEndsAt: discounted ? (offer.saleEndsAt?.toISOString() ?? null) : null,
    promotion:
      offer.promotionText &&
      (!offer.promotionEndsAt || offer.promotionEndsAt > now)
        ? {
            text: offer.promotionText,
            endsAt: offer.promotionEndsAt?.toISOString() ?? null,
          }
        : null,
  };
}
