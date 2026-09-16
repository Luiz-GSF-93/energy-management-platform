import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantGuard } from './guards/tenant.guard';
import { RoleGuard } from './guards/role.guard';
import { TenantInterceptor } from './interceptors/tenant.interceptor';
import { AuditInterceptor } from './interceptors/audit.interceptor';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'aB3cD5eF7g9hI1jK3lM5nO7pQ9rS1tU3vW5xY7z',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [TenantGuard, RoleGuard, TenantInterceptor, AuditInterceptor],
  exports: [JwtModule, TenantGuard, RoleGuard, TenantInterceptor, AuditInterceptor],
})
export class CommonModule {}
