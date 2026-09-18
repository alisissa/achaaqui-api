import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { PasswordService } from './password.service';
import type { MerchantActor } from './merchant-actor';
import type {
  MerchantLoginDto,
  MerchantLoginResponseDto,
  MerchantSessionDto,
  SetMerchantLoginDto,
} from './merchant-access.dto';

const SESSION_MS = 12 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const INVALID_LOGIN =
  'Usuário ou senha inválidos. Tente novamente mais tarde se necessário.';
export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class MerchantAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService,
  ) {}

  requireEnabled(): void {
    if (this.config.get<boolean>('MERCHANT_ACCESS_ENABLED', false) !== true)
      throw new NotFoundException();
  }

  async login(input: MerchantLoginDto): Promise<MerchantLoginResponseDto> {
    this.requireEnabled();
    const username = input.username.trim().toLowerCase();
    // Count BEFORE deriving; the atomic UPDATE also covers concurrent requests
    // and survives process restarts. No attacker-created unknown-user records.
    const users = await this.prisma.$queryRaw<
      { id: string; passwordHash: string; active: boolean }[]
    >`
      UPDATE "MerchantUser" SET
        "loginAttempts" = CASE WHEN "attemptsResetAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "loginAttempts" + 1 END,
        "attemptsResetAt" = CASE WHEN "attemptsResetAt" <= CURRENT_TIMESTAMP THEN ${new Date(Date.now() + ATTEMPT_WINDOW_MS)} ELSE "attemptsResetAt" END
      WHERE "username" = ${username}
        AND ("attemptsResetAt" <= CURRENT_TIMESTAMP OR "loginAttempts" < 5)
      RETURNING "id", "passwordHash", "active"`;
    const user = users[0];
    const valid = await this.passwords.verify(
      input.password,
      user?.active ? user.passwordHash : null,
    );
    if (!user || !valid) throw new UnauthorizedException(INVALID_LOGIN);
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MerchantUser" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.merchantUser.findFirst({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          active: true,
          merchant: { active: true },
        },
        select: {
          id: true,
          username: true,
          merchantId: true,
          merchant: { select: { id: true, name: true } },
        },
      });
      if (!current) throw new UnauthorizedException(INVALID_LOGIN);
      await tx.$queryRaw`SELECT "id" FROM "Merchant" WHERE "id" = ${current.merchantId}::uuid AND "active" = true FOR SHARE`;
      const activeMerchant = await tx.merchant.findFirst({
        where: { id: current.merchantId, active: true },
        select: { id: true },
      });
      if (!activeMerchant) throw new UnauthorizedException(INVALID_LOGIN);
      // One login per store for v1. Signing in again revokes the previous
      // session and bounds storage without a scheduler or refresh-token system.
      await tx.merchantSession.deleteMany({ where: { userId: current.id } });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + SESSION_MS);
      await tx.merchantSession.create({
        data: {
          userId: current.id,
          tokenHash: hashSessionToken(token),
          expiresAt,
        },
      });
      await tx.merchantUser.update({
        where: { id: current.id },
        data: { loginAttempts: 0, attemptsResetAt: new Date() },
      });
      return {
        token,
        username: current.username,
        merchant: current.merchant,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  async authenticate(token: string): Promise<MerchantActor> {
    this.requireEnabled();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException('Entre novamente na área do lojista.');
    const tokenHash = hashSessionToken(token);
    const session = await this.prisma.merchantSession.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
        user: { active: true, merchant: { active: true } },
      },
      select: { userId: true, user: { select: { merchantId: true } } },
    });
    if (!session)
      throw new UnauthorizedException('Entre novamente na área do lojista.');
    return {
      userId: session.userId,
      merchantId: session.user.merchantId,
      tokenHash,
    };
  }

  async me(actor: MerchantActor): Promise<MerchantSessionDto> {
    const session = await this.prisma.merchantSession.findFirst({
      where: {
        tokenHash: actor.tokenHash,
        userId: actor.userId,
        expiresAt: { gt: new Date() },
        user: {
          active: true,
          merchantId: actor.merchantId,
          merchant: { active: true },
        },
      },
      select: {
        expiresAt: true,
        user: {
          select: {
            username: true,
            merchant: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!session)
      throw new UnauthorizedException('Entre novamente na área do lojista.');
    return { ...session.user, expiresAt: session.expiresAt.toISOString() };
  }

  async logout(actor: MerchantActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MerchantUser" WHERE "id" = ${actor.userId}::uuid FOR UPDATE`;
      await tx.merchantSession.deleteMany({
        where: { userId: actor.userId, tokenHash: actor.tokenHash },
      });
    });
  }

  async provision(
    merchantId: string,
    input: SetMerchantLoginDto,
    actorId: string,
  ): Promise<{ username: string; active: boolean }> {
    const passwordHash = await this.passwords.hash(input.password);
    const username = input.username.trim().toLowerCase();
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize first-time provisioning and resets of the same store.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`merchant-login:${merchantId}`}, 0))`;
        const merchant = await tx.merchant.findUnique({
          where: { id: merchantId },
          select: { id: true },
        });
        if (!merchant) throw new NotFoundException('Loja não encontrada.');
        await tx.$queryRaw`SELECT "id" FROM "MerchantUser" WHERE "merchantId" = ${merchantId}::uuid FOR UPDATE`;
        const user = await tx.merchantUser.upsert({
          where: { merchantId },
          create: { merchantId, username, passwordHash, updatedBy: actorId },
          update: {
            username,
            passwordHash,
            updatedBy: actorId,
            active: true,
            loginAttempts: 0,
            attemptsResetAt: new Date(),
          },
          select: { id: true, username: true, active: true },
        });
        await tx.merchantSession.deleteMany({ where: { userId: user.id } });
        return { username: user.username, active: user.active };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Este nome de usuário já está em uso.');
      throw error;
    }
  }

  async status(
    merchantId: string,
  ): Promise<{ username: string; active: boolean } | null> {
    return await this.prisma.merchantUser.findUnique({
      where: { merchantId },
      select: { username: true, active: true },
    });
  }

  async setActive(
    merchantId: string,
    active: boolean,
    actorId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MerchantUser" WHERE "merchantId" = ${merchantId}::uuid FOR UPDATE`;
      const user = await tx.merchantUser.findUnique({
        where: { merchantId },
        select: { id: true },
      });
      if (!user) throw new NotFoundException('Acesso não encontrado.');
      await tx.merchantUser.update({
        where: { id: user.id },
        data: { active, updatedBy: actorId },
      });
      await tx.merchantSession.deleteMany({ where: { userId: user.id } });
    });
  }
}
