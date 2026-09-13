import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDatabaseConfig } from './config/database.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ConsumerUnitsModule } from './modules/consumer-units/consumer-units.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ValidationsModule } from './modules/validations/validations.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BackofficeModule } from './modules/backoffice/backoffice.module';
import { DocumentProcessingModule } from './modules/document-processing/document-processing.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(getDatabaseConfig()),
    AuthModule,
    UsersModule,
    CustomersModule,
    ConsumerUnitsModule,
    ContractsModule,
    DocumentsModule,
    SettlementsModule,
    InvoicesModule,
    ValidationsModule,
    ApprovalsModule,
    ReportsModule,
    NotificationsModule,
    BackofficeModule,
    DocumentProcessingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
