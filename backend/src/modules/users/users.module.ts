import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { UsersController } from './controllers/users.controller';
import { UserManagementService } from './services/user-management.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UserManagementService],
  exports: [UserManagementService],
})
export class UsersModule {}
