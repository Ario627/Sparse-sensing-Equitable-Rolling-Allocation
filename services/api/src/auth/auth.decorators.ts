import {
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  type CustomDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/client.ts';
import type { AuthenticatedUser } from './access-token.ts';

export const IS_PUBLIC_KEY = 'sera:isPublic';
export const REQUIRED_ROLES_KEY = 'sera:requiredRoles';

const MISSING_USER_MESSAGE = 'Authenticated user is required';

export const Public = (): CustomDecorator<typeof IS_PUBLIC_KEY> =>
  SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (
    ...roler: UserRole[]
): CustomDecorator<typeof REQUIRED_ROLES_KEY> => SetMetadata(REQUIRED_ROLES_KEY, roler);

export const CurrentUser = createParamDecorator<unknown, AuthenticatedUser> (
    (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
        const request = context.switchToHttp().getRequest<Request>();
        const user = request.user;
        if (user === undefined) {
            throw new UnauthorizedException(MISSING_USER_MESSAGE);
        }
        return user;
    }
)