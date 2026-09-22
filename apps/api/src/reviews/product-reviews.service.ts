import { createHash, randomBytes } from 'node:crypto';
import { assertAcceptableComment } from './comment-filter';
import { assertReviewerCanPost } from './reviewer-bans.service';
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { paginationMeta } from '../common/dto/pagination-meta.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  CreateProductReviewDto,
  OwnProductReviewDto,
  OwnProductReviewResponseDto,
  ProductReviewListDto,
  ReviewIdentityDto,
} from './product-reviews.dto';

const publicSelect = {
  id: true,
  productRating: true,
  comment: true,
  createdAt: true,
} as const;
const ownSelect = { ...publicSelect, status: true } as const;
type OwnReview = Prisma.CustomerReviewGetPayload<{ select: typeof ownSelect }>;

export function reviewIdentityHash(token: string | undefined): string {
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new UnauthorizedException('A review identity is required.');
  return createHash('sha256')
    .update(`achaaqui:review:v1:${token}`)
    .digest('hex');
}

function ownDto(review: OwnReview): OwnProductReviewDto {
  return {
    id: review.id,
    rating: review.productRating,
    comment: review.comment,
    status: review.status,
    createdAt: review.createdAt.toISOString(),
  };
}

@Injectable()
export class ProductReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private requireEnabled(): void {
    if (!this.config.get<boolean>('PRODUCT_REVIEWS_ENABLED', false))
      throw new NotFoundException();
  }

  createIdentity(): ReviewIdentityDto {
    this.requireEnabled();
    // No customer account or hardware identifier. This credential is not proof
    // of one physical device; an attacker can obtain another anonymous identity.
    return { token: randomBytes(32).toString('hex') };
  }

  private async product(slug: string): Promise<{ id: string }> {
    this.requireEnabled();
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Product not found.');
    return product;
  }

  async list(
    slug: string,
    query: PaginationQueryDto,
    token?: string,
  ): Promise<ProductReviewListDto> {
    const product = await this.product(slug);
    const blocks =
      token === undefined
        ? []
        : await this.prisma.reviewBlock.findMany({
            where: { blockerHash: reviewIdentityHash(token) },
            select: { reviewId: true, blockedReviewerHash: true },
            take: 500,
          });
    const blockedAuthors = blocks.flatMap((block) =>
      block.blockedReviewerHash ? [block.blockedReviewerHash] : [],
    );
    const where: Prisma.CustomerReviewWhereInput = {
      status: 'PUBLISHED',
      id: {
        notIn: blocks.flatMap((block) =>
          block.reviewId ? [block.reviewId] : [],
        ),
      },
      AND: [
        {
          OR: [
            { reviewerHash: null },
            { reviewerHash: { notIn: blockedAuthors } },
          ],
        },
      ],
      OR: [
        { productId: product.id },
        { merchantProduct: { productId: product.id } },
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.customerReview.count({ where }),
      this.prisma.customerReview.findMany({
        where,
        select: publicSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        rating: row.productRating,
        comment: row.comment,
        createdAt: row.createdAt.toISOString(),
      })),
      ...paginationMeta(total, query.page, query.pageSize),
    };
  }

  async mine(
    slug: string,
    token: string | undefined,
  ): Promise<OwnProductReviewResponseDto> {
    this.requireEnabled();
    const reviewerHash = reviewIdentityHash(token);
    const product = await this.product(slug);
    const review = await this.prisma.customerReview.findUnique({
      where: {
        productId_reviewerHash: { productId: product.id, reviewerHash },
      },
      select: ownSelect,
    });
    return { review: review ? ownDto(review) : null };
  }

  async create(
    slug: string,
    token: string | undefined,
    input: CreateProductReviewDto,
  ): Promise<OwnProductReviewDto> {
    this.requireEnabled();
    const reviewerHash = reviewIdentityHash(token);
    const comment = input.comment?.trim() || null;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Serialize this anonymous identity across products, including parallel
          // requests, so the database-backed submission limit cannot race.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`review:${reviewerHash}`}, 0))`;
          await assertReviewerCanPost(tx, reviewerHash);
          const products = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM "Product" WHERE slug=${slug} AND status='ACTIVE' FOR SHARE`;
          const product = products[0];
          if (!product) throw new NotFoundException('Product not found.');
          const existing = await tx.customerReview.findUnique({
            where: {
              productId_reviewerHash: { productId: product.id, reviewerHash },
            },
            select: ownSelect,
          });
          if (existing) {
            if (
              existing.productRating === input.rating &&
              existing.comment === comment
            )
              return ownDto(existing);
            throw new ConflictException(
              'You have already reviewed this product.',
            );
          }
          assertAcceptableComment(comment);
          const recent = await tx.customerReview.count({
            where: {
              reviewerHash,
              createdAt: { gte: new Date(Date.now() - 3_600_000) },
            },
          });
          const deletedRecently = await tx.reviewDeletionReceipt.count({
            where: {
              reviewerHash,
              createdAt: { gte: new Date(Date.now() - 3_600_000) },
            },
          });
          if (recent + deletedRecently >= 10)
            throw new HttpException(
              'Please wait before submitting another review.',
              429,
            );
          const created = await tx.customerReview.create({
            data: {
              productId: product.id,
              reviewerHash,
              productRating: input.rating,
              comment,
              status: 'PUBLISHED',
            },
            select: ownSelect,
          });
          return ownDto(created);
        },
        { maxWait: 5000, timeout: 10000 },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already reviewed this product.');
      }
      throw error;
    }
  }

  async deleteMine(
    slug: string,
    token: string | undefined,
    reviewId: string,
  ): Promise<void> {
    this.requireEnabled();
    const reviewerHash = reviewIdentityHash(token);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`review:${reviewerHash}`}, 0))`;
      // Allow withdrawal of hidden reviews and reviews on inactive products,
      // including by banned authors. Never accept a client-supplied owner hash.
      const review = await tx.customerReview.findFirst({
        where: { id: reviewId, reviewerHash, product: { slug } },
        select: { id: true },
      });
      // Idempotent and non-enumerating; a stale retry cannot delete a newer review.
      if (!review) return;
      await tx.reviewDeletionReceipt.create({ data: { reviewerHash } });
      await tx.reviewBlock.deleteMany({
        where: { reviewId: review.id, blockedReviewerHash: null },
      });
      await tx.customerReview.delete({ where: { id: review.id } });
      // Reports cascade; author blocks survive through the nullable FK.
      // Legacy per-review blocks without an author have nothing left to block.
    });
  }
}
