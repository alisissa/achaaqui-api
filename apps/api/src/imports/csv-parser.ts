import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { mapImportHeaders, MAX_IMPORT_ROWS } from './import-file';

export interface ParsedCsvRow {
  sourceRowNumber: number;
  rawData: Record<string, string>;
  warnings?: string[];
}

export function parseCsv(
  buffer: Buffer,
  maxRows = MAX_IMPORT_ROWS,
): ParsedCsvRow[] {
  if (buffer.includes(0)) {
    throw new BadRequestException('The CSV must be a UTF-8 text file.');
  }

  try {
    const records = parse<Record<string, string>>(buffer, {
      bom: true,
      columns: mapImportHeaders,
      to: maxRows + 1,
      max_record_size: 32_000,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length > maxRows)
      throw new Error(`Use at most ${maxRows} data rows.`);

    return records.map((rawData, index) => ({
      sourceRowNumber: index + 2,
      rawData,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Invalid CSV.';
    throw new BadRequestException(`CSV could not be parsed: ${message}`);
  }
}
