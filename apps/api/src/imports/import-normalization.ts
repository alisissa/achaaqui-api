import { OfferAvailability } from '../generated/prisma/client';

export const CANONICAL_IMPORT_FIELDS = [
  'merchantSku',
  'productName',
  'brand',
  'model',
  'barcode',
  'price',
  'currency',
  'stock',
  'availability',
] as const;

export type CanonicalImportField = (typeof CANONICAL_IMPORT_FIELDS)[number];

export interface NormalizedImportRow {
  merchantSku: string | null;
  productName: string | null;
  brand: string | null;
  model: string | null;
  barcode: string | null;
  price: string | null;
  currency: string | null;
  stock: number | null;
  availability: OfferAvailability;
}

export interface NormalizationResult {
  data: NormalizedImportRow;
  errors: string[];
  warnings: string[];
}

const HEADER_ALIASES: Record<string, CanonicalImportField> = {
  merchantsku: 'merchantSku',
  sku: 'merchantSku',
  productname: 'productName',
  product: 'productName',
  produto: 'productName',
  nome: 'productName',
  brand: 'brand',
  marca: 'brand',
  model: 'model',
  modelo: 'model',
  barcode: 'barcode',
  ean: 'barcode',
  upc: 'barcode',
  price: 'price',
  preco: 'price',
  currency: 'currency',
  moeda: 'currency',
  stock: 'stock',
  estoque: 'stock',
  availability: 'availability',
  disponibilidade: 'availability',
};

const CURRENCY_ALIASES: Record<string, string> = {
  R$: 'BRL',
  BRL: 'BRL',
  US$: 'USD',
  USD: 'USD',
  G$: 'PYG',
  '₲': 'PYG',
  PYG: 'PYG',
};

const IN_STOCK_VALUES = new Set([
  'true',
  'verdadeiro',
  '1',
  'available',
  'disponivel',
  'disponível',
  'in stock',
  'in_stock',
  'sim',
  'yes',
]);
const OUT_OF_STOCK_VALUES = new Set([
  'false',
  'falso',
  '0',
  'indisponivel',
  'indisponível',
  'nao',
  'não',
  'no',
  'out of stock',
  'out_of_stock',
  'unavailable',
]);
const UNKNOWN_VALUES = new Set(['unknown', 'desconhecido', 'n/a']);

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return cleaned || null;
}

export function canonicalHeader(value: string): string {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return Object.hasOwn(HEADER_ALIASES, cleaned)
    ? HEADER_ALIASES[cleaned]
    : value.trim();
}

export function normalizeIdentifier(value: unknown): string | null {
  const cleaned = cleanText(value);
  return cleaned ? cleaned.replace(/[\s-]+/g, '').toUpperCase() : null;
}

export function normalizePrice(value: unknown): {
  value: string | null;
  error?: string;
} {
  const text = cleanText(value)?.replace(/[\s\u00a0]/g, '');
  if (!text) return { value: null, error: 'Price is required.' };
  if (!/^\d[\d.,]*$/.test(text)) {
    return { value: null, error: 'Price contains unsupported characters.' };
  }

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  let normalized = text;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    const segments = text.split(decimalSeparator);
    if (segments.length !== 2 || !/^\d{1,2}$/.test(segments[1] ?? '')) {
      return { value: null, error: 'Price has an invalid decimal format.' };
    }
    const integerPart = segments[0] ?? '';
    const groupedIntegerPattern = new RegExp(
      `^\\d{1,3}(?:\\${thousandsSeparator}\\d{3})+$`,
    );
    if (
      !/^\d+$/.test(integerPart) &&
      !groupedIntegerPattern.test(integerPart)
    ) {
      return {
        value: null,
        error: 'Price has invalid thousands grouping.',
      };
    }
    normalized = `${integerPart.split(thousandsSeparator).join('')}.${segments[1]}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? ',' : '.';
    const segments = text.split(separator);
    if (segments.length !== 2) {
      return { value: null, error: 'Price has an invalid separator format.' };
    }
    const decimalDigits = segments[1]?.length ?? 0;
    if (decimalDigits === 3) {
      return {
        value: null,
        error: `Price “${text}” is ambiguous; use 1299.00 or 1299,00.`,
      };
    }
    if (decimalDigits < 1 || decimalDigits > 2) {
      return { value: null, error: 'Price must have at most two decimals.' };
    }
    normalized = `${segments[0]}.${segments[1]}`;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 999_999_999_999) {
    return { value: null, error: 'Price must be greater than zero.' };
  }

  return { value: numeric.toFixed(2) };
}

function normalizeCurrency(value: unknown): string | null {
  const cleaned = cleanText(value)?.toUpperCase();
  return cleaned ? (CURRENCY_ALIASES[cleaned] ?? cleaned) : null;
}

function normalizeStock(value: unknown): {
  value: number | null;
  error?: string;
} {
  const cleaned = cleanText(value);
  if (!cleaned) return { value: null };
  if (!/^\d+$/.test(cleaned)) {
    return { value: null, error: 'Stock must be a whole number.' };
  }
  const stock = Number(cleaned);
  if (!Number.isSafeInteger(stock) || stock > 100_000_000) {
    return {
      value: null,
      error: 'Stock value is outside the supported range.',
    };
  }
  return { value: stock };
}

function normalizeAvailability(
  value: unknown,
  stock: number | null,
): { value: OfferAvailability; error?: string; warning?: string } {
  const cleaned = cleanText(value)?.toLowerCase();
  let availability: OfferAvailability;
  if (!cleaned) {
    availability =
      stock === null
        ? OfferAvailability.UNKNOWN
        : stock > 0
          ? OfferAvailability.IN_STOCK
          : OfferAvailability.OUT_OF_STOCK;
  } else if (IN_STOCK_VALUES.has(cleaned)) {
    availability = OfferAvailability.IN_STOCK;
  } else if (OUT_OF_STOCK_VALUES.has(cleaned)) {
    availability = OfferAvailability.OUT_OF_STOCK;
  } else if (UNKNOWN_VALUES.has(cleaned)) {
    availability = OfferAvailability.UNKNOWN;
  } else {
    return {
      value: OfferAvailability.UNKNOWN,
      error: `Availability “${cleaned}” is not supported.`,
    };
  }

  if (availability === OfferAvailability.IN_STOCK && stock === 0) {
    return {
      value: availability,
      error: 'Availability says in stock but stock is zero.',
    };
  }
  if (
    availability === OfferAvailability.OUT_OF_STOCK &&
    stock !== null &&
    stock > 0
  ) {
    return {
      value: availability,
      error: 'Availability says out of stock but stock is greater than zero.',
    };
  }
  return {
    value: availability,
    ...(availability === OfferAvailability.UNKNOWN && stock === null
      ? { warning: 'Availability and stock are both unknown.' }
      : {}),
  };
}

export function normalizeImportRecord(
  record: Record<string, unknown>,
  supportedCurrencies: ReadonlySet<string>,
): NormalizationResult {
  const merchantSku = cleanText(record.merchantSku)?.toUpperCase() ?? null;
  const productName = cleanText(record.productName);
  const price = normalizePrice(record.price);
  const currency = normalizeCurrency(record.currency);
  const stock = normalizeStock(record.stock);
  const availability = normalizeAvailability(record.availability, stock.value);
  const errors = [price.error, stock.error, availability.error].filter(
    (item): item is string => Boolean(item),
  );
  const warnings = [availability.warning].filter((item): item is string =>
    Boolean(item),
  );

  if (!merchantSku) errors.push('Merchant SKU is required.');
  if (!productName) errors.push('Product name is required.');
  for (const [field, value, max] of [
    ['Merchant SKU', merchantSku, 120],
    ['Product name', productName, 240],
    ['Brand', cleanText(record.brand), 120],
    ['Model', cleanText(record.model), 160],
    ['Barcode', normalizeIdentifier(record.barcode), 32],
  ] as const) {
    if (value && value.length > max)
      errors.push(`${field} exceeds ${max} characters.`);
  }
  if (!currency) {
    errors.push('Currency is required.');
  } else if (!supportedCurrencies.has(currency)) {
    errors.push(`Currency ${currency} is not supported.`);
  }

  return {
    data: {
      merchantSku,
      productName,
      brand: cleanText(record.brand),
      model: cleanText(record.model),
      barcode: normalizeIdentifier(record.barcode),
      price: price.value,
      currency,
      stock: stock.value,
      availability: availability.value,
    },
    errors,
    warnings,
  };
}
