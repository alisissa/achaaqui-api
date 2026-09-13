import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Workbook } from 'exceljs';
import { PrismaService } from '../database/prisma.service';
import { CANONICAL_IMPORT_FIELDS } from './import-normalization';
import { MAX_IMPORT_ROWS } from './import-file';
import type { ImportTemplateQueryDto } from './imports.dto';

export interface ImportTemplateFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export function csvCell(value: string): string {
  // Spreadsheet apps interpret formula prefixes even in quoted CSV cells.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

@Injectable()
export class ImportTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async download(query: ImportTemplateQueryDto): Promise<ImportTemplateFile> {
    const rows = query.merchantId
      ? await this.merchantRows(query.merchantId)
      : [];
    const filename = `achaaqui-${query.merchantId ? 'merchant-offers' : 'import-template'}.${query.format}`;
    if (query.format === 'csv') {
      return {
        filename,
        contentType: 'text/csv; charset=utf-8',
        buffer: Buffer.from(
          '\uFEFF' +
            [
              CANONICAL_IMPORT_FIELDS.join(','),
              ...rows.map((row) => row.map(csvCell).join(',')),
            ].join('\r\n') +
            '\r\n',
        ),
      };
    }
    const workbook = new Workbook();
    workbook.creator = 'AchaAqui';
    const sheet = workbook.addWorksheet('Catalog', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = CANONICAL_IMPORT_FIELDS.map((field) => ({
      header: field,
      key: field,
      width: field === 'productName' ? 42 : 22,
      style: { numFmt: '@' },
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF111111' },
    };
    sheet.addRows(rows);
    const instructions = workbook.addWorksheet('Instructions');
    instructions.columns = [
      { header: 'Field', width: 24 },
      { header: 'How to fill it in', width: 110 },
    ];
    instructions.addRows([
      [
        'merchantSku',
        'Required. Your unique SKU, as Text. Keep leading zeros.',
      ],
      [
        'productName',
        'Required. Exact variant name, including distinguishing details. Unmatched rows propose new products; names never auto-match.',
      ],
      [
        'brand / model',
        'Brand is required for new products. Model is optional.',
      ],
      [
        'barcode',
        'Optional. New products require 8, 12, 13, or 14 digits, not a repeated digit. Use a real barcode as Text, preserving leading zeros, or leave blank. Never reuse a barcode for different products.',
      ],
      [
        'price',
        'Required, positive, maximum two decimals. Examples: 1299.00 or 1299,00. No currency symbols.',
      ],
      ['currency', 'Required: BRL, USD, or PYG.'],
      [
        'stock',
        'Optional, whole number from 0 to 100000000. Empty means unknown.',
      ],
      [
        'availability',
        'IN_STOCK, OUT_OF_STOCK, or UNKNOWN. May be blank to infer from stock.',
      ],
      [
        'Limits',
        '500 rows / 2 MB. One visible data sheet. No formulas, hidden rows, merged cells, or macros.',
      ],
      [
        'Before upload',
        'Keep Catalog row 1. Replace or remove unwanted data rows. The blank template contains no sample offers.',
      ],
      [
        'After upload',
        'Review validation and price changes. Only an explicit commit changes offers.',
      ],
      [
        'Removed offers',
        'Imports never restore removed offers. Restore explicitly in the merchant catalog.',
      ],
      [
        'category',
        'Optional existing category name. Blank means Uncategorized for new products; review the warning.',
      ],
    ]);
    if (query.locale === 'pt-BR') {
      // Keep machine-readable field names and the Instructions sheet name
      // stable so both languages round-trip through the same parser.
      const pt = [
        ['Campo', 'Como preencher'],
        [
          'merchantSku',
          'Obrigatório. SKU exclusivo do lojista, como Texto. Preserve os zeros à esquerda.',
        ],
        [
          'productName',
          'Obrigatório. Nome da variante exata, com seus detalhes. Linhas sem correspondência propõem novos produtos; nomes nunca vinculam automaticamente.',
        ],
        [
          'brand / model',
          'Marca obrigatória para novos produtos. Modelo opcional.',
        ],
        [
          'barcode',
          'Opcional. Use o código de barras real como Texto, preservando zeros à esquerda. Nunca reutilize o mesmo código para produtos diferentes.',
        ],
        [
          'price',
          'Obrigatório, positivo, com até duas casas decimais. Exemplos: 1299.00 ou 1299,00. Sem símbolo de moeda.',
        ],
        ['currency', 'Obrigatório: BRL, USD ou PYG.'],
        [
          'stock',
          'Opcional. Número inteiro de 0 a 100000000. Em branco significa não informado.',
        ],
        [
          'availability',
          'IN_STOCK (em estoque), OUT_OF_STOCK (sem estoque) ou UNKNOWN (não informado). Aceita TRUE/FALSE ou SIM/NÃO. Em branco, será inferido pelo estoque.',
        ],
        [
          'Limites',
          '500 linhas / 2 MB. Uma aba visível de dados. Sem fórmulas, linhas ocultas, células mescladas ou macros.',
        ],
        [
          'Antes do envio',
          'Mantenha a primeira linha da aba Catalog. Substitua ou remova linhas indesejadas. O modelo em branco não contém produtos de exemplo. No Numbers, exporte para Excel (.xlsx) ou CSV.',
        ],
        [
          'Após o envio',
          'Confira a validação, os SKUs convertidos e as alterações de preço. Somente a confirmação explícita altera os produtos publicados.',
        ],
        [
          'Produtos removidos',
          'Importações nunca restauram produtos removidos. Restaure-os explicitamente no catálogo do lojista.',
        ],
        [
          'category',
          'Opcional. Nome de uma categoria existente. Em branco, novos produtos ficam sem categoria (Uncategorized); confira o aviso.',
        ],
      ];
      pt.forEach((values, index) => {
        instructions.getRow(index + 1).values = values;
      });
    }
    instructions.getRow(1).font = { bold: true };
    instructions.eachRow((row) => {
      row.alignment = { vertical: 'top', wrapText: true };
    });
    return {
      filename,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  private async merchantRows(merchantId: string): Promise<string[][]> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { active: true },
    });
    if (!merchant?.active)
      throw new NotFoundException('Active merchant not found.');
    const offers = await this.prisma.merchantProduct.findMany({
      where: { merchantId, active: true, product: { status: 'ACTIVE' } },
      take: MAX_IMPORT_ROWS + 1,
      orderBy: { merchantSku: 'asc' },
      select: {
        merchantSku: true,
        price: true,
        currency: true,
        stockQuantity: true,
        availability: true,
        product: {
          select: {
            name: true,
            model: true,
            barcode: true,
            brand: { select: { name: true } },
            category: { select: { name: true } },
          },
        },
      },
    });
    if (offers.length > MAX_IMPORT_ROWS)
      throw new BadRequestException(
        'This merchant has over 500 offers. Use the blank template for batches of up to 500 rows.',
      );
    return offers.map((offer) => [
      offer.merchantSku,
      offer.product.name,
      offer.product.brand.name,
      offer.product.model ?? '',
      offer.product.barcode ?? '',
      offer.price.toFixed(2),
      offer.currency,
      offer.stockQuantity === null ? '' : String(offer.stockQuantity),
      offer.availability,
      offer.product.category.name,
    ]);
  }
}
