import { BadRequestException } from '@nestjs/common';
import { Workbook, type Cell } from 'exceljs';
import { Readable } from 'node:stream';
import type { ParsedCsvRow } from './csv-parser';
import { mapImportHeaders, MAX_IMPORT_ROWS } from './import-file';
import { validateXlsxArchive } from './xlsx-archive';

function cellText(cell: Cell, field?: string): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    if (value.length > 1000)
      throw new BadRequestException(
        `Cell ${cell.address} exceeds 1,000 characters.`,
      );
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (field === 'barcode' || field === 'merchantSku') {
      throw new BadRequestException(
        `Cell ${cell.address}: format ${field} as Text to preserve leading zeros.`,
      );
    }
    return String(value);
  }
  throw new BadRequestException(
    `Cell ${cell.address}: use plain text or numbers; formulas, dates, and linked cells are not accepted.`,
  );
}

export async function parseXlsx(
  buffer: Buffer,
  maxRows = MAX_IMPORT_ROWS,
): Promise<ParsedCsvRow[]> {
  await validateXlsxArchive(buffer);
  const workbook = new Workbook();
  try {
    await workbook.xlsx.read(Readable.from(buffer));
  } catch {
    throw new BadRequestException(
      'XLSX could not be parsed. Save a plain .xlsx workbook and try again.',
    );
  }
  const sheets = workbook.worksheets.filter(
    (sheet) => sheet.name !== 'Instructions',
  );
  if (sheets.length !== 1 || sheets[0]?.state !== 'visible') {
    throw new BadRequestException(
      'Use one visible data worksheet, plus an optional Instructions sheet.',
    );
  }
  const sheet = sheets[0];
  if (!sheet || sheet.columnCount > 32 || sheet.rowCount > maxRows + 1) {
    throw new BadRequestException(
      `Use at most ${maxRows} data rows and 32 columns.`,
    );
  }
  if (sheet.model.merges?.length)
    throw new BadRequestException('Merged cells are not supported.');
  const headers = mapImportHeaders(
    Array.from({ length: sheet.columnCount }, (_, i) =>
      cellText(sheet.getCell(1, i + 1)),
    ),
  );
  const rows: ParsedCsvRow[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    if (row.hidden)
      throw new BadRequestException(
        `Row ${number} is hidden. Unhide it before importing.`,
      );
    const values = headers.map((field, i) =>
      cellText(row.getCell(i + 1), field),
    );
    if (!values.some(Boolean)) return;
    rows.push({
      sourceRowNumber: number,
      rawData: Object.fromEntries(
        headers.map((field, i) => [field, values[i] ?? '']),
      ),
    });
  });
  return rows;
}
