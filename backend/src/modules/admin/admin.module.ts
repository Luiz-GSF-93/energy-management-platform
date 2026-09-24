import { AuthModule } from '../auth/auth.module';
import { UserRecoveryController } from './users/controllers/user-recovery.controller';
import { UserRecoveryService } from './users/services/user-recovery.service';
import { OrganizationSetupController } from './organizations/controllers/organization-setup.controller';
import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { OrganizationsController } from './organizations/controllers/organizations.controller';
import { OrganizationsService } from './organizations/services/organizations.service';
import { UsersController } from './users/controllers/users.controller';
import { UsersService } from './users/services/users.service';

@Module({
  imports: [CommonModule, AuthModule],
  controllers: [UserRecoveryController, OrganizationsController, OrganizationSetupController, UsersController],
  providers: [UserRecoveryService, OrganizationsService, UsersService],
  exports: [OrganizationsService],
})
export class AdminModule {}
