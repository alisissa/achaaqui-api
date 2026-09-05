import { describe, expect, it } from 'vitest';
import { OfferAvailability } from '../src/generated/prisma/client';
import { parseCsv } from '../src/imports/csv-parser';
import {
  normalizeImportRecord,
  normalizePrice,
} from '../src/imports/import-normalization';

const currencies = new Set(['BRL', 'USD', 'PYG']);

describe('CSV import normalization', () => {
  it.each([
    ['1299.00', '1299.00'],
    ['1299,90', '1299.90'],
    ['1.299,90', '1299.90'],
    ['1,299.90', '1299.90'],
  ])('should normalize safe price %s to %s', (input, expected) => {
    expect(normalizePrice(input)).toEqual({ value: expected });
  });

  it('should reject an ambiguous single separator with three trailing digits', () => {
    const result = normalizePrice('1,299');
    expect(result.value).toBeNull();
    expect(result.error).toContain('ambiguous');
  });

  it('should reject malformed thousands grouping', () => {
    const result = normalizePrice('12.34,56');

    expect(result.value).toBeNull();
    expect(result.error).toContain('thousands grouping');
  });

  it('should reject negative prices', () => {
    expect(normalizePrice('-12.00').error).toContain('unsupported characters');
  });

  it('should infer availability from stock and normalize Portuguese aliases', () => {
    const result = normalizeImportRecord(
      {
        merchantSku: ' br-100 ',
        productName: 'Phone',
        barcode: '0195-9498-22015',
        price: '4.500,00',
        currency: 'R$',
        stock: '4',
      },
      currencies,
    );

    expect(result.errors).toEqual([]);
    expect(result.data).toMatchObject({
      merchantSku: 'BR-100',
      barcode: '0195949822015',
      price: '4500.00',
      currency: 'BRL',
      stock: 4,
      availability: OfferAvailability.IN_STOCK,
    });
  });

  it('should reject inconsistent stock and availability', () => {
    const result = normalizeImportRecord(
      {
        merchantSku: 'BR-101',
        productName: 'Phone',
        price: '100.00',
        currency: 'BRL',
        stock: '0',
        availability: 'sim',
      },
      currencies,
    );

    expect(result.errors).toContain(
      'Availability says in stock but stock is zero.',
    );
  });

  it('should parse quoted cells and common Portuguese headers', () => {
    const rows = parseCsv(
      Buffer.from(
        'sku,nome,preco,moeda,estoque,ean\nSKU-1,"Phone, Blue","4.500,00",BRL,2,0195949822015',
      ),
    );

    expect(rows).toEqual([
      {
        sourceRowNumber: 2,
        rawData: {
          merchantSku: 'SKU-1',
          productName: 'Phone, Blue',
          price: '4.500,00',
          currency: 'BRL',
          stock: '2',
          barcode: '0195949822015',
        },
      },
    ]);
  });
});
