import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseService } from './services/supabase.service';

// Módulos de funcionalidades
import { AuthModule } from './modules/auth/auth.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ConsumerUnitsModule } from './modules/consumer-units/consumer-units.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { ValidationsModule } from './modules/validations/validations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    CustomersModule,
    ConsumerUnitsModule,
    ContractsModule,
    DocumentsModule,
    SettlementsModule,
    ValidationsModule,
  ],
  controllers: [AppController],
  providers: [AppService, SupabaseService],
})
export class AppModule {}
