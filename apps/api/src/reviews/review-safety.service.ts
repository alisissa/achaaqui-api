import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { reviewIdentityHash } from './product-reviews.service';
import { ReportReviewDto, ReviewSafetyResultDto } from './review-safety.dto';

@Injectable()
export class ReviewSafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async save(
    id: string,
    token: string | undefined,
    report?: ReportReviewDto,
  ): Promise<ReviewSafetyResultDto> {
    this.requireEnabled();
    const hash = reviewIdentityHash(token);
    return await this.prisma.$transaction(async (tx) => {
      // Serializes quotas and duplicate requests for this identity, not other customers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`review-safety:${hash}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM "CustomerReview" WHERE id=${id}::uuid FOR SHARE`;
      const review = await tx.customerReview.findFirst({
        where: {
          id,
          status: 'PUBLISHED',
          OR: [
            { product: { status: 'ACTIVE' } },
            { merchantProduct: { product: { status: 'ACTIVE' } } },
          ],
        },
        select: { reviewerHash: true },
      });
      if (!review) throw new NotFoundException('Review not found.');
      if (review.reviewerHash === hash)
        throw new BadRequestException(
          'You cannot report or block your own review.',
        );
      if (report) {
        const existing = await tx.reviewReport.findUnique({
          where: {
            reviewId_reporterHash: { reviewId: id, reporterHash: hash },
          },
          select: { id: true },
        });
        if (existing) return { saved: true };
        const recent = await tx.reviewReport.count({
          where: {
            reporterHash: hash,
            createdAt: { gte: new Date(Date.now() - 86_400_000) },
          },
        });
        if (recent >= 20)
          throw new HttpException(
            'Please wait before reporting another review.',
            429,
          );
        await tx.reviewReport.create({
          data: { reviewId: id, reporterHash: hash, reason: report.reason },
          select: { id: true },
        });
      } else {
        const existing = await tx.reviewBlock.findUnique({
          where: { blockerHash_reviewId: { blockerHash: hash, reviewId: id } },
          select: { id: true },
        });
        if (existing) return { saved: true };
        if (
          (await tx.reviewBlock.count({ where: { blockerHash: hash } })) >= 500
        )
          throw new HttpException('Review block limit reached.', 429);
        await tx.reviewBlock.create({
          data: {
            reviewId: id,
            blockerHash: hash,
            blockedReviewerHash: review.reviewerHash,
          },
          select: { id: true },
        });
      }
      return { saved: true };
    });
  }

  async clearBlocks(token: string | undefined): Promise<ReviewSafetyResultDto> {
    this.requireEnabled();
    const blockerHash = reviewIdentityHash(token);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`review-safety:${blockerHash}`}, 0))`;
      await tx.reviewBlock.deleteMany({ where: { blockerHash } });
    });
    return { saved: true };
  }

  private requireEnabled(): void {
    if (!this.config.get<boolean>('PRODUCT_REVIEWS_ENABLED', false))
      throw new NotFoundException();
  }
}
