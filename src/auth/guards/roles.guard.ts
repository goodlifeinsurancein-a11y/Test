import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../auth.service.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(
        ROLES_KEY,
        [
          context.getHandler(),
          context.getClass(),
        ],
      );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request =
      context.switchToHttp().getRequest();

    const authUser = request.authUser;

    if (!authUser?.id) {
      throw new ForbiddenException(
        'Authenticated user not found',
      );
    }

    const profile =
      await this.authService.getAuthenticatedProfile(
        authUser.id,
      );

    if (!profile) {
      throw new ForbiddenException(
        'User profile not found',
      );
    }

    if (profile.status !== 'ACTIVE') {
      throw new ForbiddenException(
        'User account is not active',
      );
    }

    if (!requiredRoles.includes(profile.role)) {
      throw new ForbiddenException(
        'Insufficient permissions',
      );
    }

    request.profile = profile;

    return true;
  }
}
