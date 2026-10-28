import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  Optional,ServiceUnavailableException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap,mergeMap } from 'rxjs/operators';
import { RequestWithTenant } from '../interfaces/tenant-context.interface';
import { Reflector } from '@nestjs/core';
import { RECOVERY_ENDPOINT_KEY } from '../decorators/recovery-endpoint.decorator';
import {portalRequestScope,assertCurrentPortalScope} from '../services/portal-customer-context';
import {SupabaseService} from '../../services/supabase.service';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector,@Optional() private db?:SupabaseService) {}

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

    if (request.body && Object.prototype.hasOwnProperty.call(request.body, 'organization_id')) {
      if (request.body.organization_id !== organizationId) {
        throw new BadRequestException(
          'Cannot modify data from a different organization',
        );
      }
    }

    // Tenant authority lives in the authenticated context, never in a DTO.
    // Injecting organization_id here made strict DTOs reject legitimate writes.

    const selected=request.tenantContext?.portalCustomerScope;
    const handled=selected?new Observable(subscriber=>{
      const subscription=portalRequestScope.run(selected,()=>next.handle().subscribe(subscriber));
      return()=>subscription.unsubscribe();
    }):next.handle();
    return handled.pipe(
      mergeMap(async value=>{if(selected){if(!this.db)throw new ServiceUnavailableException('Validação do Portal indisponível.');await assertCurrentPortalScope(this.db.getClient(),selected);}return value;}),
      tap(() => {
        const duration = Date.now() - startTime;
        console.log(
          `[TenantInterceptor] ${request.method} ${request.path} | Org: ${organizationId} | ${duration}ms`,
        );
      }),
    );
  }
}
