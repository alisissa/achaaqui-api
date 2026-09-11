import type { NormalizedImportRow } from './import-normalization';

export const IMPORT_ACTIONS = {
  NEW_OFFER: 'NEW_OFFER',
  PRICE_CHANGE: 'PRICE_CHANGE',
  INVENTORY_CHANGE: 'INVENTORY_CHANGE',
  UNCHANGED: 'UNCHANGED',
  BLOCKED: 'BLOCKED',
} as const;

export type ImportAction = (typeof IMPORT_ACTIONS)[keyof typeof IMPORT_ACTIONS];

export interface StoredNormalizedRow extends NormalizedImportRow {
  action: ImportAction;
  currentPrice: string | null;
  currentCurrency: string | null;
  currentUpdatedAt: string | null;
}

export interface ImportSummary {
  totalRows: number;
  newOffers: number;
  priceChanges: number;
  inventoryChanges: number;
  unchanged: number;
  invalid: number;
  warnings: number;
  committable: number;
}

export function emptyImportSummary(): ImportSummary {
  return {
    totalRows: 0,
    newOffers: 0,
    priceChanges: 0,
    inventoryChanges: 0,
    unchanged: 0,
    invalid: 0,
    warnings: 0,
    committable: 0,
  };
}

export function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function storedNormalizedRow(value: unknown): StoredNormalizedRow {
  const row = jsonObject(value);
  const action = Object.values(IMPORT_ACTIONS).includes(
    row.action as ImportAction,
  )
    ? (row.action as ImportAction)
    : IMPORT_ACTIONS.BLOCKED;

  return {
    merchantSku: typeof row.merchantSku === 'string' ? row.merchantSku : null,
    productName: typeof row.productName === 'string' ? row.productName : null,
    brand: typeof row.brand === 'string' ? row.brand : null,
    model: typeof row.model === 'string' ? row.model : null,
    barcode: typeof row.barcode === 'string' ? row.barcode : null,
    price: typeof row.price === 'string' ? row.price : null,
    currency: typeof row.currency === 'string' ? row.currency : null,
    stock: typeof row.stock === 'number' ? row.stock : null,
    availability: row.availability as StoredNormalizedRow['availability'],
    action,
    currentPrice:
      typeof row.currentPrice === 'string' ? row.currentPrice : null,
    currentCurrency:
      typeof row.currentCurrency === 'string' ? row.currentCurrency : null,
    currentUpdatedAt:
      typeof row.currentUpdatedAt === 'string' ? row.currentUpdatedAt : null,
  };
}

export function importSummaryFromJson(value: unknown): ImportSummary {
  const summary = jsonObject(value);
  const empty = emptyImportSummary();
  return Object.fromEntries(
    Object.keys(empty).map((key) => [
      key,
      typeof summary[key] === 'number' ? summary[key] : 0,
    ]),
  ) as unknown as ImportSummary;
}
