import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service';
import { parseCsv } from '../src/imports/csv-parser';
import { parseXlsx } from '../src/imports/xlsx-parser';
import { CANONICAL_IMPORT_FIELDS } from '../src/imports/import-normalization';
import {
  csvCell,
  ImportTemplateService,
} from '../src/imports/import-template.service';

async function workbookBytes(
  change?: (book: Workbook) => void,
): Promise<Buffer> {
  const book = new Workbook();
  const sheet = book.addWorksheet('Catalog');
  sheet.addRow([...CANONICAL_IMPORT_FIELDS]);
  sheet.addRow([
    '0001',
    'Test phone',
    'Brand',
    'Model',
    '0012345678901',
    123.45,
    'BRL',
    2,
    'IN_STOCK',
  ]);
  change?.(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('CSV and XLSX import files', () => {
  it('should parse XLSX plain values and preserve text identifiers exactly', async () => {
    const rows = await parseXlsx(await workbookBytes());
    expect(rows).toEqual([
      {
        sourceRowNumber: 2,
        rawData: {
          merchantSku: '0001',
          productName: 'Test phone',
          brand: 'Brand',
          model: 'Model',
          barcode: '0012345678901',
          price: '123.45',
          currency: 'BRL',
          stock: '2',
          availability: 'IN_STOCK',
        },
      },
    ]);
  });
  it('should reject numeric barcodes rather than silently dropping leading zeros', async () => {
    await expect(
      parseXlsx(
        await workbookBytes((book) => {
          book.worksheets[0].getCell('E2').value = 12345678901;
        }),
      ),
    ).rejects.toThrow('format barcode as Text');
  });
  it('should reject formulas even if Excel cached their result', async () => {
    await expect(
      parseXlsx(
        await workbookBytes((book) => {
          book.worksheets[0].getCell('F2').value = {
            formula: '1+1',
            result: 2,
          };
        }),
      ),
    ).rejects.toThrow('formulas');
  });
  it('should reject hidden rows and ambiguous extra worksheets', async () => {
    await expect(
      parseXlsx(
        await workbookBytes((book) => {
          book.worksheets[0].getRow(2).hidden = true;
        }),
      ),
    ).rejects.toThrow('hidden');
    await expect(
      parseXlsx(
        await workbookBytes((book) => {
          book.addWorksheet('More products').addRow(['data']);
        }),
      ),
    ).rejects.toThrow('one visible data worksheet');
  });
  it('should accept Portuguese aliases and retain spreadsheet row numbers', async () => {
    const book = new Workbook();
    const sheet = book.addWorksheet('Produtos');
    sheet.addRow(['sku', 'nome', 'preço', 'moeda']);
    sheet.getCell('A4').value = '001';
    sheet.getCell('B4').value = 'Phone';
    sheet.getCell('C4').value = '19,99';
    sheet.getCell('D4').value = 'BRL';
    const rows = await parseXlsx(Buffer.from(await book.xlsx.writeBuffer()));
    expect(rows[0]).toMatchObject({
      sourceRowNumber: 4,
      rawData: { merchantSku: '001', price: '19,99' },
    });
  });
  it('should reject missing and duplicate canonical headers in both formats', async () => {
    expect(() => parseCsv(Buffer.from('sku,nome,price\n1,A,12'))).toThrow(
      'currency',
    );
    expect(() =>
      parseCsv(
        Buffer.from('sku,merchantSku,nome,price,currency\n1,2,A,12,BRL'),
      ),
    ).toThrow('Duplicate');
    await expect(
      parseXlsx(
        await workbookBytes((book) => {
          book.worksheets[0].getCell('C1').value = 'sku';
        }),
      ),
    ).rejects.toThrow('Duplicate');
  });
  it('should reject row overflow and invalid workbook bytes', async () => {
    await expect(
      parseXlsx(
        await workbookBytes((book) => {
          book.worksheets[0].getCell('A502').value = 'too many';
        }),
      ),
    ).rejects.toThrow('500');
    expect(() =>
      parseCsv(
        Buffer.from('sku,nome,price,currency\n' + '1,A,12,BRL\n'.repeat(501)),
      ),
    ).toThrow('500');
    await expect(parseXlsx(Buffer.from('not a zip'))).rejects.toThrow(
      'Invalid',
    );
  });
  it('should reject expanded workbook content over the bounded limit', async () => {
    const buffer = await workbookBytes((book) => {
      const sheet = book.worksheets[0];
      for (let i = 3; i < 380; i++)
        sheet.getCell(`B${i}`).value = `${i}-${'X'.repeat(30000)}`;
    });
    await expect(parseXlsx(buffer)).rejects.toThrow(/too large|10 MB/);
  });
});

describe('downloadable import templates', () => {
  let templates: ImportTemplateService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ImportTemplateService,
        { provide: PrismaService, useValue: {} },
        { provide: ConfigService, useValue: {} },
      ],
    }).compile();
    templates = module.get(ImportTemplateService);
  });
  it('should generate an empty CSV and XLSX without accidental sample offers', async () => {
    const csv = await templates.download({ format: 'csv' });
    const xlsx = await templates.download({ format: 'xlsx' });
    expect(parseCsv(csv.buffer)).toEqual([]);
    expect(await parseXlsx(xlsx.buffer)).toEqual([]);
    expect(xlsx.contentType).toContain('spreadsheetml');
  });
  it('should neutralize CSV formula prefixes and escape quoted text', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('Phone, "blue"')).toBe('"Phone, ""blue"""');
  });
  it('should fail before exporting when the selected merchant is inactive', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ImportTemplateService,
        {
          provide: PrismaService,
          useValue: {
            merchant: {
              findUnique: vi.fn().mockResolvedValue({ active: false }),
            },
          },
        },
      ],
    }).compile();
    await expect(
      module
        .get(ImportTemplateService)
        .download({ format: 'csv', merchantId: 'merchant' }),
    ).rejects.toThrow('Active merchant');
  });
});
