import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { Prisma, type ImportStatus } from '../generated/prisma/client';
import {
  lockMerchantAccess,
  type MerchantActor,
} from '../merchant-access/merchant-actor';
import {
  ImportStagingService,
  type UploadedCsvFile,
} from './import-staging.service';
import { ImportsService } from './imports.service';
import { ImportCommitService } from './import-commit.service';
import {
  IMPORT_ROW_VERSION_SELECT,
  importPreviewToken,
  jsonObject,
  stringArray,
} from './import-types';
import { CANONICAL_IMPORT_FIELDS } from './import-normalization';
import {
  PhotoOcrService,
  PHOTO_REVIEW_WARNING,
  PHOTO_UNCERTAIN_ERROR,
} from './photo-ocr.service';
import { CommitPhotoImportDto, ResolvePhotoRowDto } from './photo-import.dto';
import type { AdminImportDetailDto } from './imports.dto';

const busy = (): HttpException => new HttpException('PHOTO_LIMIT_REACHED', 429);
const EDIT_SELECT = {
  status: true,
  rows: {
    orderBy: { sourceRowNumber: 'asc' },
    select: {
      ...IMPORT_ROW_VERSION_SELECT,
      sourceRowNumber: true,
      rawData: true,
    },
  },
} satisfies Prisma.ImportSelect;
type EditableImport = Prisma.ImportGetPayload<{ select: typeof EDIT_SELECT }>;

@Injectable()
export class PhotoImportService {
  private inFlight = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ocr: PhotoOcrService,
    private readonly staging: ImportStagingService,
    private readonly imports: ImportsService,
    private readonly commits: ImportCommitService,
  ) {}

  requireEnabled(): void {
    if (!this.config.get<boolean>('PHOTO_IMPORT_ENABLED', false))
      throw new NotFoundException('PHOTO_DISABLED');
  }

  async upload(
    actor: MerchantActor,
    file: UploadedCsvFile | undefined,
  ): Promise<AdminImportDetailDto> {
    this.requireEnabled();
    if (this.inFlight >= 1) throw busy();
    this.inFlight++;
    let id: string | undefined;
    try {
      const image = await this.ocr.sanitize(file);
      id = await this.reserve(actor, image);
      const extracted = await this.ocr.extract(image);
      const prepared = await this.staging.prepareRows(
        actor.merchantId,
        extracted,
      );
      await this.prisma.$transaction(async (tx) => {
        await lockMerchantAccess(tx, actor);
        await tx.import.update({
          where: { id, merchantId: actor.merchantId, status: 'UPLOADED' },
          data: {
            status: 'READY',
            previewedAt: new Date(),
            summary: { ...prepared.summary },
            rows: { create: prepared.rows },
          },
        });
      });
      return await this.imports.detail(id, actor.merchantId);
    } catch (error: unknown) {
      if (id)
        await this.prisma.import.updateMany({
          where: { id, merchantId: actor.merchantId, status: 'UPLOADED' },
          data: { status: 'FAILED', failedAt: new Date() },
        });
      throw error;
    } finally {
      this.inFlight--;
    }
  }

  private async reserve(actor: MerchantActor, image: Buffer): Promise<string> {
    return await this.prisma.$transaction(async (tx) => {
      await lockMerchantAccess(tx, actor);
      // Serialize quota reservation across processes/restarts, not only per IP.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('photo-import-quota', 0))`;
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      const global = await tx.import.count({
        where: { sourceType: 'PHOTO', createdAt: { gte: day } },
      });
      const own = await tx.import.count({
        where: {
          sourceType: 'PHOTO',
          merchantId: actor.merchantId,
          createdAt: { gte: day },
        },
      });
      const recent = await tx.import.count({
        where: {
          sourceType: 'PHOTO',
          merchantId: actor.merchantId,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
      });
      if (global >= 200 || own >= 20 || recent >= 3) throw busy();
      const item = await tx.import.create({
        data: {
          merchantId: actor.merchantId,
          actorId: `merchant:${actor.userId}`,
          sourceType: 'PHOTO',
          status: 'UPLOADED',
          originalFilename: 'photo.jpg',
          commitKey: `photo:${randomUUID()}`,
          sourceReference: `sha256:${createHash('sha256').update(image).digest('hex')}`,
          mappingSnapshot: {
            version: 1,
            mode: 'photo',
            provider: 'mistral',
            model: 'mistral-ocr-4-1',
          },
        },
        select: { id: true },
      });
      return item.id;
    });
  }

  async detail(
    actor: MerchantActor,
    id: string,
  ): Promise<AdminImportDetailDto> {
    this.requireEnabled();
    return await this.imports.detail(id, actor.merchantId);
  }

  async list(
    actor: MerchantActor,
  ): Promise<{ id: string; status: ImportStatus; createdAt: Date }[]> {
    this.requireEnabled();
    return await this.prisma.import.findMany({
      where: { merchantId: actor.merchantId, sourceType: 'PHOTO' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, status: true, createdAt: true },
    });
  }

  private async lockPreview(
    tx: Prisma.TransactionClient,
    actor: MerchantActor,
    id: string,
    expected: string,
  ): Promise<EditableImport> {
    await lockMerchantAccess(tx, actor);
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "Import" WHERE "id" = ${id}::uuid AND "merchantId" = ${actor.merchantId}::uuid AND "sourceType" = 'PHOTO' FOR UPDATE`;
    if (!locked.length) throw new NotFoundException('Import not found.');
    const item = await tx.import.findUnique({
      where: { id, merchantId: actor.merchantId },
      select: EDIT_SELECT,
    });
    if (
      !item ||
      item.status !== 'READY' ||
      importPreviewToken(id, item.rows) !== expected
    )
      throw new ConflictException('PHOTO_PREVIEW_CHANGED');
    return item;
  }

  async resolve(
    actor: MerchantActor,
    id: string,
    rowId: string,
    input: ResolvePhotoRowDto,
  ): Promise<AdminImportDetailDto> {
    this.requireEnabled();
    await this.prisma.$transaction(
      async (tx) => {
        const item = await this.lockPreview(
          tx,
          actor,
          id,
          input.expectedPreviewToken,
        );
        if (!item.rows.some((row) => row.id === rowId))
          throw new NotFoundException('Import row not found.');
        const activeRows = item.rows.filter((row) =>
          row.id === rowId ? !input.skip : row.status !== 'SKIPPED',
        );
        const prepared = await this.staging.prepareRows(
          actor.merchantId,
          activeRows.map((row) => ({
            sourceRowNumber: row.sourceRowNumber,
            rawData:
              row.id === rowId
                ? { ...input.input }
                : this.rowInput(row.normalizedData),
            warnings: [PHOTO_REVIEW_WARNING],
            errors:
              row.id !== rowId &&
              stringArray(row.validationErrors).includes(PHOTO_UNCERTAIN_ERROR)
                ? [PHOTO_UNCERTAIN_ERROR]
                : [],
          })),
        );
        // Revalidate ALL remaining rows: fixing/skipping one can clear duplicates
        // in another. Original OCR rawData is retained, never overwritten.
        for (const row of prepared.rows) {
          const data = { ...row, rawData: undefined };
          await tx.importRow.update({
            where: {
              importId_sourceRowNumber: {
                importId: id,
                sourceRowNumber: row.sourceRowNumber,
              },
            },
            data,
          });
        }
        if (input.skip)
          await tx.importRow.update({
            where: { id: rowId, importId: id },
            data: {
              status: 'SKIPPED',
              normalizedData: {
                ...jsonObject(
                  item.rows.find((row) => row.id === rowId)?.normalizedData,
                ),
                input: { ...input.input },
              },
              commitResult: {
                action: 'SKIPPED_BY_MERCHANT',
                actorId: `merchant:${actor.userId}`,
              },
            },
          });
        await tx.import.update({
          where: { id, merchantId: actor.merchantId },
          data: {
            summary: {
              ...prepared.summary,
              totalRows: item.rows.length,
              skipped: item.rows.length - activeRows.length,
            },
            previewedAt: new Date(),
          },
        });
      },
      { timeout: 30_000 },
    );
    return await this.detail(actor, id);
  }

  private rowInput(normalized: unknown): Record<string, string> {
    const input = jsonObject(jsonObject(normalized).input);
    return Object.fromEntries(
      CANONICAL_IMPORT_FIELDS.map((field) => [
        field,
        typeof input[field] === 'string' ? input[field] : '',
      ]),
    );
  }

  async commit(
    actor: MerchantActor,
    id: string,
    input: CommitPhotoImportDto,
  ): Promise<AdminImportDetailDto> {
    this.requireEnabled();
    await this.commits.commit(id, input, `merchant:${actor.userId}`, actor);
    return await this.detail(actor, id);
  }

  async remaining(
    actor: MerchantActor,
    id: string,
  ): Promise<AdminImportDetailDto> {
    this.requireEnabled();
    const next = await this.prisma.$transaction(
      async (tx) => {
        await lockMerchantAccess(tx, actor);
        await tx.$queryRaw`SELECT "id" FROM "Import" WHERE "id" = ${id}::uuid AND "merchantId" = ${actor.merchantId}::uuid FOR UPDATE`;
        const item = await tx.import.findUnique({
          where: { id, merchantId: actor.merchantId, sourceType: 'PHOTO' },
          include: { rows: { orderBy: { sourceRowNumber: 'asc' } } },
        });
        if (!item) throw new NotFoundException('Import not found.');
        if (item.status !== 'COMMITTED')
          throw new ConflictException('PHOTO_PREVIEW_CHANGED');
        const commitKey = `photo-remainder:${id}`;
        const existing = await tx.import.findUnique({
          where: { commitKey, merchantId: actor.merchantId },
          select: { id: true },
        });
        if (existing) return existing.id;
        const rows = item.rows.filter(
          (row) =>
            row.status === 'INVALID' ||
            (row.status === 'SKIPPED' &&
              jsonObject(row.commitResult).action === 'SKIPPED_BY_MERCHANT'),
        );
        if (!rows.length)
          throw new ConflictException('PHOTO_NO_REMAINING_ROWS');
        const prepared = await this.staging.prepareRows(
          actor.merchantId,
          rows.map((row) => ({
            sourceRowNumber: row.sourceRowNumber,
            rawData: this.rowInput(row.normalizedData),
            warnings: [PHOTO_REVIEW_WARNING],
            errors: stringArray(row.validationErrors).includes(
              PHOTO_UNCERTAIN_ERROR,
            )
              ? [PHOTO_UNCERTAIN_ERROR]
              : [],
          })),
        );
        const created = await tx.import.create({
          data: {
            merchantId: actor.merchantId,
            actorId: `merchant:${actor.userId}`,
            sourceType: 'PHOTO',
            status: 'READY',
            commitKey,
            originalFilename: 'remaining-rows',
            mappingSnapshot: {
              version: 1,
              mode: 'photo-corrections',
              previousImportId: id,
            },
            summary: { ...prepared.summary },
            previewedAt: new Date(),
            rows: {
              create: prepared.rows.map((row, index) => ({
                ...row,
                rawData: rows[index].rawData as Prisma.InputJsonValue,
              })),
            },
          },
          select: { id: true },
        });
        return created.id;
      },
      { timeout: 30_000 },
    );
    return await this.detail(actor, next);
  }

  async cancel(
    actor: MerchantActor,
    id: string,
    expected: string,
  ): Promise<void> {
    this.requireEnabled();
    await this.prisma.$transaction(async (tx) => {
      await this.lockPreview(tx, actor, id, expected);
      await tx.import.update({
        where: { id, merchantId: actor.merchantId },
        data: { status: 'CANCELLED' },
      });
    });
  }
}
