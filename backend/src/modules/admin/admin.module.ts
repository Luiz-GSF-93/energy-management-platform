import { AuthModule } from '../auth/auth.module';
import {UserRequestsController} from './users/controllers/user-requests.controller';
import {UserRequestsService} from './users/services/user-requests.service';
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
  controllers: [UserRequestsController, UserRecoveryController, OrganizationsController, OrganizationSetupController, UsersController],
  providers: [UserRequestsService, UserRecoveryService, OrganizationsService, UsersService],
  exports: [OrganizationsService,UserRequestsService],
})
export class AdminModule {}
