import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Módulos compartilhados
import { SharedModule } from './modules/shared/shared.module';

// Módulos de funcionalidades
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ConsumerUnitsModule } from './modules/consumer-units/consumer-units.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { ValidationsModule } from './modules/validations/validations.module';
import { AuditModule } from './modules/audit/audit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ManagementFeesModule } from './modules/management-fees/management-fees.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { BackofficeModule } from './modules/backoffice/backoffice.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    SharedModule,
    AuthModule,
    CustomersModule,
    ConsumerUnitsModule,
    ContractsModule,
    DocumentsModule,
    SettlementsModule,
    ValidationsModule,
    AuditModule,
    ReportsModule,
    NotificationsModule,
    InvoicesModule,
    ManagementFeesModule,
    ApprovalsModule,
    BackofficeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
