import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { AdminRequest } from './admin-actor';
import { FirebaseAdminAuthService } from './firebase-admin-auth.service';

function equalSecrets(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly firebase: FirebaseAdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    delete request.adminActor;
    const authorization = request.header('authorization');
    if (this.configService.get<string>('ADMIN_AUTH_MODE') === 'firebase') {
      const match = /^(Bearer|Session) ([^\s]+)$/.exec(authorization ?? '');
      if (!match || match[2].length > 8192) {
        throw new UnauthorizedException(
          'A valid administrator session is required.',
        );
      }
      request.adminActor = await this.firebase.verify(
        match[2],
        match[1] === 'Session',
      );
      return true;
    }
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException(
        'Firebase administrator authentication is required.',
      );
    }
    const provided = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    const expected = this.configService.get<string>('ADMIN_API_KEY', '');

    if (!provided || !expected || !equalSecrets(provided, expected)) {
      throw new UnauthorizedException('Administrative access is required.');
    }

    request.adminActor = { id: 'local-admin', role: 'platform_admin' };
    return true;
  }
}
