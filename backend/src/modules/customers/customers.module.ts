import { Module } from '@nestjs/common';
import { CustomersService } from './services/customers.service';
import { CustomersController } from './controllers/customers.controller';
import { SupabaseService } from '../../services/supabase.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, SupabaseService],
  exports: [CustomersService],
})
export class CustomersModule {}
