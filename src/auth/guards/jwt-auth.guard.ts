import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    const accessToken = authorization.slice(7).trim();

    if (!accessToken) {
      throw new UnauthorizedException('Missing access token');
    }

    const user = await this.authService.getUserFromToken(accessToken);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.authUser = user;

    return true;
  }
}
