import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma } from '../generated/prisma/client';

export interface MerchantActor {
  userId: string;
  merchantId: string;
  tokenHash: string;
}
export type MerchantRequest = Request & { merchantActor?: MerchantActor };

export const CurrentMerchant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MerchantActor => {
    const actor = context
      .switchToHttp()
      .getRequest<MerchantRequest>().merchantActor;
    if (!actor)
      throw new UnauthorizedException('Entre novamente na área do lojista.');
    return actor;
  },
);

// Every merchant write rechecks authority INSIDE its transaction. Logout,
// password reset and disable take the exclusive user lock before revoking.
export async function lockMerchantAccess(
  tx: Prisma.TransactionClient,
  actor: MerchantActor,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "MerchantUser" WHERE "id" = ${actor.userId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Merchant" WHERE "id" = ${actor.merchantId}::uuid FOR SHARE`;
  const session = await tx.merchantSession.findFirst({
    where: {
      tokenHash: actor.tokenHash,
      expiresAt: { gt: new Date() },
      userId: actor.userId,
      user: {
        merchantId: actor.merchantId,
        active: true,
        merchant: { active: true },
      },
    },
    select: { tokenHash: true },
  });
  if (!session)
    throw new UnauthorizedException('Entre novamente na área do lojista.');
}
