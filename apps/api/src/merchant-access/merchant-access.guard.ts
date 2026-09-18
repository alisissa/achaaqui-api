import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import { MerchantAccessService } from './merchant-access.service';
import type { MerchantRequest } from './merchant-actor';

@Injectable()
export class MerchantAccessGuard implements CanActivate {
  constructor(private readonly access: MerchantAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MerchantRequest>();
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'private, no-store');
    delete request.merchantActor;
    this.access.requireEnabled();
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      request.header('authorization') ?? '',
    );
    if (!match)
      throw new UnauthorizedException('Entre novamente na área do lojista.');
    request.merchantActor = await this.access.authenticate(match[1]);
    return true;
  }
}
