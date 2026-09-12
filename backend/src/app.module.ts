import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';

// Modules
import { SharedModule } from './modules/shared/shared.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ConsumerUnitsModule } from './modules/consumer-units/consumer-units.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ValidationsModule } from './modules/validations/validations.module';
import { BackofficeModule } from './modules/backoffice/backoffice.module';
import { ManagementFeesModule } from './modules/management-fees/management-fees.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { EnginesModule } from './modules/engines/engines.module';
import { DocumentProcessingModule } from './modules/document-processing/document-processing.module';

// Controllers & Services
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '7d' },
    }),
    // Core
    SharedModule,
    AuthModule,
    UsersModule,
    
    // Domain
    CustomersModule,
    ConsumerUnitsModule,
    ContractsModule,
    DocumentsModule,
    SettlementsModule,
    InvoicesModule,
    
    // Engines & Calculations
    EnginesModule,
    ValidationsModule,
    
    // Management
    ManagementFeesModule,
    ApprovalsModule,
    
    // Operations
    ReportsModule,
    NotificationsModule,
    BackofficeModule,
    
    // Document Processing
    DocumentProcessingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
