import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import {
  CANONICAL_IMPORT_FIELDS,
  canonicalHeader,
} from './import-normalization';

export interface ParsedCsvRow {
  sourceRowNumber: number;
  rawData: Record<string, string>;
}

export function parseCsv(buffer: Buffer): ParsedCsvRow[] {
  if (buffer.includes(0)) {
    throw new BadRequestException('The CSV must be a UTF-8 text file.');
  }

  try {
    const records = parse<Record<string, string>>(buffer, {
      bom: true,
      columns: (headers: string[]) => {
        const mapped = headers.map(canonicalHeader);
        const duplicates = mapped.filter(
          (header, index) =>
            CANONICAL_IMPORT_FIELDS.includes(
              header as (typeof CANONICAL_IMPORT_FIELDS)[number],
            ) && mapped.indexOf(header) !== index,
        );
        if (duplicates.length > 0) {
          throw new Error(`Duplicate column: ${duplicates[0]}`);
        }
        return mapped;
      },
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((rawData, index) => ({
      sourceRowNumber: index + 2,
      rawData,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid CSV.';
    throw new BadRequestException(`CSV could not be parsed: ${message}`);
  }
}
