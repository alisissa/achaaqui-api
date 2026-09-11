import { BadRequestException } from '@nestjs/common';
import {
  CANONICAL_IMPORT_FIELDS,
  canonicalHeader,
} from './import-normalization';

export const MAX_IMPORT_BYTES = 2_097_152;
export const MAX_IMPORT_ROWS = 500;

export function mapImportHeaders(headers: string[]): string[] {
  if (headers.length > 32)
    throw new BadRequestException('Use at most 32 columns.');
  const mapped = headers.map(canonicalHeader);
  const known = mapped.filter((header) =>
    CANONICAL_IMPORT_FIELDS.includes(
      header as (typeof CANONICAL_IMPORT_FIELDS)[number],
    ),
  );
  if (new Set(known).size !== known.length) {
    throw new BadRequestException(
      'Duplicate import columns, including aliases, are not allowed.',
    );
  }
  for (const required of ['merchantSku', 'productName', 'price', 'currency']) {
    if (!mapped.includes(required)) {
      throw new BadRequestException(`Missing required column: ${required}.`);
    }
  }
  return mapped;
}
