export const FRESHNESS_STATUSES = [
  'FRESH',
  'AGING',
  'STALE',
  'UNAVAILABLE',
] as const;

export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

export class FreshnessDto {
  declare status: FreshnessStatus;
  declare updatedAt: string;
}
