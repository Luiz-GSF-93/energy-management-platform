import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { RequestWithTenant } from '../interfaces/tenant-context.interface';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { organizationId, userId, email } = request.tenantContext || {};
    const startTime = Date.now();
    const method = request.method;
    const path = request.path;

    return next.handle().pipe(
      tap((response) => {
        const duration = Date.now() - startTime;
        this.logAudit({
          organizationId,
          userId,
          email,
          action: method,
          resource: path,
          status: 'success',
          duration,
          timestamp: new Date(),
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logAudit({
          organizationId,
          userId,
          email,
          action: method,
          resource: path,
          status: 'error',
          duration,
          errorMessage: error.message,
          timestamp: new Date(),
        });
        return of(error);
      }),
    );
  }

  private logAudit(data: any): void {
    console.log('[AuditLog]', JSON.stringify(data));
  }
}
