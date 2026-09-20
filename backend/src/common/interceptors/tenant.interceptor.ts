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
import { Reflector } from '@nestjs/core';
import { RECOVERY_ENDPOINT_KEY } from '../decorators/recovery-endpoint.decorator';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();

    const isRecoveryEndpoint = this.reflector.get<boolean>(
      RECOVERY_ENDPOINT_KEY,
      context.getHandler(),
    );

    if (isRecoveryEndpoint) {
      const startTime = Date.now();
      return next.handle().pipe(
        tap(() => {
          const duration = Date.now() - startTime;
          console.log(
            `[TenantInterceptor] ${request.method} ${request.path} | Recovery Mode | ${duration}ms`,
          );
        }),
      );
    }

    const authorizationContext =
      request.accessContext || request.tenantContext;
    const startTime = Date.now();

    if (authorizationContext?.scope === 'global') {
      return next.handle().pipe(
        tap(() => {
          const duration = Date.now() - startTime;
          console.log(
            `[TenantInterceptor] ${request.method} ${request.path} | Platform Scope | ${duration}ms`,
          );
        }),
      );
    }

    const organizationId = request.tenantContext?.organizationId;

    if (request.body && request.body.organization_id) {
      if (request.body.organization_id !== organizationId) {
        throw new BadRequestException(
          'Cannot modify data from a different organization',
        );
      }
    }

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
