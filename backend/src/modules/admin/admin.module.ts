import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { OrganizationsController } from './organizations/controllers/organizations.controller';
import { OrganizationsService } from './organizations/services/organizations.service';

@Module({
  imports: [CommonModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class AdminModule {}
