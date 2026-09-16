import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RequestWithTenant } from '../interfaces/tenant-context.interface';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { organizationId } = request.tenantContext || {};
    const startTime = Date.now();

    // Se houver body com organizationId, validar que é o mesmo do token
    if (request.body && request.body.organization_id) {
      if (request.body.organization_id !== organizationId) {
        throw new BadRequestException(
          'Cannot modify data from a different organization',
        );
      }
    }

    // Injetar organizationId no body se não estiver presente
    if (request.body && !request.body.organization_id) {
      request.body.organization_id = organizationId;
    }

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        console.log(
          `[TenantInterceptor] ${request.method} ${request.path} | Org: ${organizationId} | ${duration}ms`,
        );
      }),
    );
  }
}
