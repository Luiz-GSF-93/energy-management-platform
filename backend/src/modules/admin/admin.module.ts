import { OrganizationSetupController } from './organizations/controllers/organization-setup.controller';
import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { OrganizationsController } from './organizations/controllers/organizations.controller';
import { OrganizationsService } from './organizations/services/organizations.service';
import { UsersController } from './users/controllers/users.controller';
import { UsersService } from './users/services/users.service';

@Module({
  imports: [CommonModule],
  controllers: [OrganizationsController, OrganizationSetupController, UsersController],
  providers: [OrganizationsService, UsersService],
  exports: [OrganizationsService],
})
export class AdminModule {}
