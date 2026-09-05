import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OfferAvailability } from '../../generated/prisma/client';
import { FreshnessDto, type FreshnessStatus } from './freshness.dto';

@Injectable()
export class FreshnessService {
  private readonly agingMilliseconds: number;
  private readonly staleMilliseconds: number;

  constructor(configService: ConfigService) {
    this.agingMilliseconds =
      configService.get<number>('FRESHNESS_AGING_HOURS', 72) * 60 * 60 * 1000;
    this.staleMilliseconds =
      configService.get<number>('FRESHNESS_STALE_HOURS', 168) * 60 * 60 * 1000;
  }

  forOffer(
    availability: OfferAvailability,
    updatedAt: Date,
    now = new Date(),
  ): FreshnessDto {
    return {
      status:
        availability === 'OUT_OF_STOCK'
          ? 'UNAVAILABLE'
          : this.statusForDate(updatedAt, now),
      updatedAt: updatedAt.toISOString(),
    };
  }

  forProduct(
    offers: ReadonlyArray<{
      availability: OfferAvailability;
      sourceUpdatedAt: Date;
    }>,
    now = new Date(),
  ): FreshnessDto | null {
    if (offers.length === 0) {
      return null;
    }

    const availableOffers = offers.filter(
      (offer) => offer.availability !== 'OUT_OF_STOCK',
    );
    const candidates = availableOffers.length > 0 ? availableOffers : offers;
    const mostRecent = candidates.reduce((latest, offer) =>
      offer.sourceUpdatedAt > latest.sourceUpdatedAt ? offer : latest,
    );

    if (availableOffers.length === 0) {
      return {
        status: 'UNAVAILABLE',
        updatedAt: mostRecent.sourceUpdatedAt.toISOString(),
      };
    }

    return {
      status: this.statusForDate(mostRecent.sourceUpdatedAt, now),
      updatedAt: mostRecent.sourceUpdatedAt.toISOString(),
    };
  }

  private statusForDate(updatedAt: Date, now: Date): FreshnessStatus {
    const age = Math.max(0, now.getTime() - updatedAt.getTime());

    if (age >= this.staleMilliseconds) {
      return 'STALE';
    }

    if (age >= this.agingMilliseconds) {
      return 'AGING';
    }

    return 'FRESH';
  }
}
