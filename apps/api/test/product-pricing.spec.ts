import { describe, expect, it } from 'vitest';
import { OfferAvailability, Prisma } from '../src/generated/prisma/client';
import {
  lowestPricesByCurrency,
  orderedOffers,
  singleCurrencyBestPrice,
} from '../src/products/products.service';

describe('product offer currency policy', () => {
  const offers = [
    {
      availability: OfferAvailability.IN_STOCK,
      currency: 'PYG',
      price: new Prisma.Decimal('3900000'),
    },
    {
      availability: OfferAvailability.IN_STOCK,
      currency: 'BRL',
      price: new Prisma.Decimal('2800'),
    },
    {
      availability: OfferAvailability.IN_STOCK,
      currency: 'BRL',
      price: new Prisma.Decimal('2750'),
    },
  ];

  it('finds a lowest price inside each currency instead of across currencies', () => {
    const prices = lowestPricesByCurrency(offers);

    expect(prices).toEqual([
      { amount: '2750', currency: 'BRL' },
      { amount: '3900000', currency: 'PYG' },
    ]);
    expect(singleCurrencyBestPrice(prices)).toBeNull();
  });

  it('groups deterministic ordering by currency after availability', () => {
    const ordered = orderedOffers(offers);

    expect(ordered.map((offer) => `${offer.currency}:${offer.price.toString()}`)).toEqual([
      'BRL:2750',
      'BRL:2800',
      'PYG:3900000',
    ]);
  });
});
