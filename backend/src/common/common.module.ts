import { Module } from '@nestjs/common';
import { TenantGuard } from './guards/tenant.guard';
import { RoleGuard } from './guards/role.guard';
import { TenantInterceptor } from './interceptors/tenant.interceptor';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { SupabaseService } from '../services/supabase.service';

@Module({
  providers: [
    SupabaseService,
    TenantGuard,
    RoleGuard,
    TenantInterceptor,
    AuditInterceptor,
  ],
  exports: [
    SupabaseService,
    TenantGuard,
    RoleGuard,
    TenantInterceptor,
    AuditInterceptor,
  ],
})
export class CommonModule {}
