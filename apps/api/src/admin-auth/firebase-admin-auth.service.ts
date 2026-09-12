import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { AdminActor } from './admin-actor';

@Injectable()
export class FirebaseAdminAuthService {
  constructor(private readonly config: ConfigService) {}

  private auth(): Auth {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    if (!projectId)
      throw new UnauthorizedException('Administrative access is unavailable.');
    const name = `achaaqui-api-${projectId}`;
    const app =
      getApps().find((candidate) => candidate.name === name) ??
      initializeApp({ projectId, credential: applicationDefault() }, name);
    return getAuth(app);
  }

  async verify(token: string, session: boolean): Promise<AdminActor> {
    let claims: DecodedIdToken;
    let currentRole: unknown;
    try {
      const auth = this.auth();
      claims = session
        ? await auth.verifySessionCookie(token, true)
        : await auth.verifyIdToken(token, true);
      // Removing a role must also deny a previously issued token.
      const user = await auth.getUser(claims.uid);
      if (user.disabled || !user.emailVerified)
        throw new Error('Account unavailable');
      currentRole = user.customClaims?.role;
    } catch {
      throw new UnauthorizedException(
        'A valid administrator session is required.',
      );
    }
    if (
      claims.email_verified !== true ||
      claims.firebase?.sign_in_provider !== 'google.com' ||
      claims.role !== 'platform_admin' ||
      currentRole !== 'platform_admin'
    ) {
      // Merchant roles cannot use platform-wide routes, whatever merchantId is
      // supplied. Merchant self-service requires a separately scoped release.
      throw new ForbiddenException(
        'Platform administrator access is required.',
      );
    }
    return { id: `firebase:${claims.uid}`, role: 'platform_admin' };
  }
}
