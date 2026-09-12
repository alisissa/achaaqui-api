import 'reflect-metadata';
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApiKeyGuard } from '../src/admin-auth/admin-api-key.guard';
import { FirebaseAdminAuthService } from '../src/admin-auth/firebase-admin-auth.service';
import type { AdminRequest } from '../src/admin-auth/admin-actor';
import { AdminImportsController } from '../src/imports/admin-imports.controller';
import { AdminMerchantsController } from '../src/merchants/admin-merchants.controller';
import {
  AdminMerchantOffersController,
  AdminCatalogProductsController,
} from '../src/merchants/admin-merchant-offers.controller';
import { AdminReviewsController } from '../src/reviews/admin-reviews.controller';
import { AdminSearchAnalyticsController } from '../src/analytics/admin-search-analytics.controller';

const sdk = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  verifySessionCookie: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('firebase-admin/app', () => ({
  applicationDefault: vi.fn(),
  getApps: () => [],
  initializeApp: vi.fn(),
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => sdk }));

const adminClaims = {
  uid: 'approved-user',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
  role: 'platform_admin',
};
const adminUser = {
  disabled: false,
  emailVerified: true,
  customClaims: { role: 'platform_admin' },
};
const config = (): ConfigService =>
  new ConfigService({
    NODE_ENV: 'production',
    ADMIN_AUTH_MODE: 'firebase',
    FIREBASE_PROJECT_ID: 'achaaqui-web',
    ADMIN_API_KEY: 'old-shared-key',
  });

beforeEach(() => {
  vi.resetAllMocks();
  sdk.verifyIdToken.mockResolvedValue(adminClaims);
  sdk.verifySessionCookie.mockResolvedValue(adminClaims);
  sdk.getUser.mockResolvedValue(adminUser);
});

describe('Firebase administrator verification', () => {
  it.each([false, true])(
    'verifies SDK revocation and the current role (session=%s)',
    async (session) => {
      const service = new FirebaseAdminAuthService(config());
      await expect(service.verify('credential', session)).resolves.toEqual({
        id: 'firebase:approved-user',
        role: 'platform_admin',
      });
      expect(
        session ? sdk.verifySessionCookie : sdk.verifyIdToken,
      ).toHaveBeenCalledWith('credential', true);
      expect(sdk.getUser).toHaveBeenCalledWith('approved-user');
    },
  );

  it.each(['expired', 'revoked', 'wrong-project', 'bad-signature'])(
    'rejects SDK failure: %s',
    async (reason) => {
      sdk.verifyIdToken.mockRejectedValue(new Error(reason));
      await expect(
        new FirebaseAdminAuthService(config()).verify('credential', false),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sdk.getUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...adminClaims, role: undefined },
    { ...adminClaims, role: 'merchant', merchantId: 'merchant-a' },
    { ...adminClaims, role: 'merchant', merchantId: 'merchant-b' },
    { ...adminClaims, email_verified: false },
    { ...adminClaims, firebase: { sign_in_provider: 'password' } },
  ])('rejects unapproved or non-Google claims %#', async (claims) => {
    sdk.verifyIdToken.mockResolvedValue(claims);
    await expect(
      new FirebaseAdminAuthService(config()).verify('credential', false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a previously issued token after the current admin role is removed', async () => {
    sdk.getUser.mockResolvedValue({ ...adminUser, customClaims: {} });
    await expect(
      new FirebaseAdminAuthService(config()).verify('credential', true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    { ...adminUser, disabled: true },
    { ...adminUser, emailVerified: false },
  ])('rejects disabled or unverified accounts %#', async (user) => {
    sdk.getUser.mockResolvedValue(user);
    await expect(
      new FirebaseAdminAuthService(config()).verify('credential', true),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

function requestContext(authorization?: string): {
  request: AdminRequest;
  context: ExecutionContext;
} {
  const request = {
    header: () => authorization,
    adminActor: { id: 'forged', role: 'platform_admin' },
  } as unknown as AdminRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, context };
}

describe('administrative route boundary', () => {
  it.each(['Bearer credential', 'Session credential'])(
    'derives the actor from verified %s',
    async (header) => {
      const input = requestContext(header);
      await new AdminApiKeyGuard(
        config(),
        new FirebaseAdminAuthService(config()),
      ).canActivate(input.context);
      expect(input.request.adminActor?.id).toBe('firebase:approved-user');
    },
  );

  it.each([
    undefined,
    '',
    'Basic credential',
    'Bearer a b',
    'Session ',
    `Bearer ${'a'.repeat(8193)}`,
  ])(
    'rejects malformed credentials %# and clears forged identity',
    async (header) => {
      const input = requestContext(header);
      await expect(
        new AdminApiKeyGuard(
          config(),
          new FirebaseAdminAuthService(config()),
        ).canActivate(input.context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(input.request.adminActor).toBeUndefined();
      expect(sdk.verifyIdToken).not.toHaveBeenCalled();
    },
  );

  it('never accepts the legacy shared API key in production', async () => {
    const local = new ConfigService({
      NODE_ENV: 'production',
      ADMIN_AUTH_MODE: 'local-key',
      ADMIN_API_KEY: 'old-shared-key',
    });
    await expect(
      new AdminApiKeyGuard(
        local,
        new FirebaseAdminAuthService(local),
      ).canActivate(requestContext('Bearer old-shared-key').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('retains explicit local-only authentication for development', async () => {
    const local = new ConfigService({
      NODE_ENV: 'test',
      ADMIN_AUTH_MODE: 'local-key',
      ADMIN_API_KEY: 'local-key',
    });
    const input = requestContext('Bearer local-key');
    await new AdminApiKeyGuard(
      local,
      new FirebaseAdminAuthService(local),
    ).canActivate(input.context);
    expect(input.request.adminActor?.id).toBe('local-admin');
  });

  it.each([
    AdminImportsController,
    AdminMerchantsController,
    AdminMerchantOffersController,
    AdminCatalogProductsController,
    AdminReviewsController,
    AdminSearchAnalyticsController,
  ])('protects all operations on %s at controller level', (controller) => {
    const guards: unknown[] = Reflect.getMetadata(
      GUARDS_METADATA,
      controller,
    ) as unknown[];
    expect(guards).toContain(AdminApiKeyGuard);
  });
});
