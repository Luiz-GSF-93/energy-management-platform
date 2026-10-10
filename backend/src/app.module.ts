import {SalesIntakeModule} from './modules/sales-intake/sales-intake.module';
import {PlatformTeamModule} from './modules/platform-team/platform-team.module';
import {PlatformWorkflowsModule} from './modules/platform-workflows/platform-workflows.module';
import {PortalLicenseModule} from './modules/client-portal-licenses/portal-license.module';
import {PortalLicenseGuard} from './modules/client-portal-licenses/portal-license.guard';
import {BotReportsModule} from './modules/bot-reports/bot-reports.module';
import {CustomerNoticesModule} from './modules/customer-notices/customer-notices.module';
import {SmsDeliveryModule} from './modules/sms-delivery/sms-delivery.module';
import {WhatsappDeliveryModule} from './modules/whatsapp-delivery/whatsapp-delivery.module';
import {EnergyPricesModule} from './modules/energy-prices/energy-prices.module';
import {AclAdmissionsModule} from './modules/acl-admissions/acl-admissions.module';
import {ReportsModule} from './modules/reports/reports.module';
import {EnergyMapModule} from './modules/energy-map/energy-map.module';
import {TradingHubModule} from './modules/trading-hub/trading-hub.module';
import {PlatformCostsModule} from './modules/platform-costs/platform-costs.module';
import {PerformanceMiddleware} from './modules/platform-costs/performance.middleware';
import {OperationsModule} from './modules/operations/operations.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { PlansModule } from './modules/plans/plans.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import {CceeModule} from './modules/ccee/ccee.module';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ConsumerUnitsModule } from './modules/consumer-units/consumer-units.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AdminModule } from './modules/admin/admin.module';
import { LicensesModule } from './modules/licenses/licenses.module';
import { SupabaseService } from './services/supabase.service';
import { CommonModule } from './common/common.module';
import { TenantGuard } from './common/guards/tenant.guard';
import { RoleGuard } from './common/guards/role.guard';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    PlatformTeamModule,
    SalesIntakeModule,
    PlatformWorkflowsModule,
    PortalLicenseModule,
    AuthModule,
    CustomersModule,
    ConsumerUnitsModule,
    ContractsModule,
    DocumentsModule,
    AdminModule,
    LicensesModule,
    DashboardModule,
    PlansModule,
    PlatformCostsModule,
    OcrModule,
    OperationsModule,
    TradingHubModule,
    EnergyMapModule,
    ReportsModule,
    BotReportsModule,
    AclAdmissionsModule,
    EnergyPricesModule,
    CceeModule,
    WhatsappDeliveryModule,
    SmsDeliveryModule,
    CustomerNoticesModule,
  ],
  controllers: [AppController],
  providers: [
    PerformanceMiddleware,
    AppService,
    SupabaseService,
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
    {provide: APP_GUARD,useClass: PortalLicenseGuard},
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PerformanceMiddleware,RateLimitMiddleware).forRoutes('*');
  }
}
