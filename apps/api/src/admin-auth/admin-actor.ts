import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AdminActor {
  id: string;
  role: 'platform_admin';
}
export type AdminRequest = Request & { adminActor?: AdminActor };

export const ActorId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const actor = context.switchToHttp().getRequest<AdminRequest>().adminActor;
    if (!actor)
      throw new UnauthorizedException('Administrative access is required.');
    return actor.id;
  },
);
