import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { SetReviewerAccessDto } from './review-safety.dto';

// Call only while holding review:<hash>, shared with submit/moderation/ban.
export async function assertReviewerCanPost(
  tx: Prisma.TransactionClient,
  reviewerHash: string,
  admin = false,
): Promise<void> {
  const ban = await tx.reviewerBan.findUnique({
    where: { reviewerHash },
    select: { active: true },
  });
  if (ban?.active) {
    if (admin)
      throw new ConflictException(
        'Unban this reviewer before publishing their reviews.',
      );
    throw new ForbiddenException(
      'This anonymous identity cannot submit reviews. Contact support.',
    );
  }
}

@Injectable()
export class ReviewerBansService {
  constructor(private readonly prisma: PrismaService) {}

  async setAccess(
    reviewId: string,
    input: SetReviewerAccessDto,
    actorId: string,
  ): Promise<{ saved: boolean }> {
    return await this.prisma.$transaction(
      async (tx) => {
        const review = await tx.customerReview.findUnique({
          where: { id: reviewId },
          select: { reviewerHash: true },
        });
        if (!review) throw new NotFoundException('Review not found.');
        const reviewerHash = review.reviewerHash;
        if (!reviewerHash)
          throw new BadRequestException(
            'This legacy review has no anonymous identity to ban.',
          );
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`review:${reviewerHash}`}, 0))`;
        const current = await tx.reviewerBan.findUnique({
          where: { reviewerHash },
          select: { revision: true },
        });
        if ((current?.revision ?? null) !== input.expectedRevision)
          throw new ConflictException(
            'Reviewer access changed. Refresh the page before confirming again.',
          );
        const data = {
          active: input.banned,
          revision: randomUUID(),
          updatedBy: actorId,
        };
        await tx.reviewerBan.upsert({
          where: { reviewerHash },
          create: { reviewerHash, ...data },
          update: data,
        });
        if (input.banned) {
          await tx.customerReview.updateMany({
            where: { reviewerHash },
            data: {
              status: 'REJECTED',
              moderatedAt: new Date(),
              moderatedBy: actorId,
            },
          });
        }
        // Unban never republishes reviews or removes personal blocks/reports.
        return { saved: true };
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
