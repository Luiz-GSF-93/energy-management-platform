import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { DocumentAuthService } from '../services/document-auth.service';

@Injectable()
export class DocumentAuthGuard implements CanActivate {
  constructor(private authService: DocumentAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // Se não tiver token, usar headers x-organization-id e x-empresa-id
    if (!authHeader) {
      const organizationId = request.headers['x-organization-id'];
      const empresaId = request.headers['x-empresa-id'];

      if (!organizationId || !empresaId) {
        throw new UnauthorizedException('Missing authorization or organization headers');
      }

      request.auth = { organizationId, empresaId };
      return true;
    }

    // Se tiver token Bearer
    const token = authHeader.replace('Bearer ', '');
    const validation = this.authService.validateToken(token);

    if (!validation.valid) {
      throw new UnauthorizedException('Invalid token');
    }

    request.auth = validation.payload;
    return true;
  }
}
