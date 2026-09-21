import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { PERMISSIONS } from '../../../common/constants/permissions';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { Tenant } from '../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { CreateLicenseDto } from '../dto/create-license.dto';
import { UpdateLicenseDto } from '../dto/update-license.dto';
import { LicensesService } from '../services/licenses.service';

@Controller('licenses')
export class LicensesController {
  constructor(private readonly licensesService: LicensesService) {}

  @Post()
  @RequirePermission([PERMISSIONS.ORGANIZATION_LICENSES_CREATE])
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async create(
    @Body() dto: CreateLicenseDto,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ) {
    return this.licensesService.create(dto, {
      actorUserId: tenant.userId,
      organizationId: tenant.organizationId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Patch(':licenseId')
  @RequirePermission([PERMISSIONS.ORGANIZATION_LICENSES_UPDATE])
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  async update(
    @Param('licenseId') licenseId: string,
    @Body() dto: UpdateLicenseDto,
    @Tenant() tenant: TenantContext,
    @Req() request: Request,
  ) {
    return this.licensesService.update(licenseId, dto, {
      actorUserId: tenant.userId,
      organizationId: tenant.organizationId,
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Get('effective')
  @RequirePermission([PERMISSIONS.ORGANIZATION_LICENSES_VIEW])
  async findEffective(@Tenant() tenant: TenantContext) {
    return this.licensesService.resolveEffectiveLicense(tenant.organizationId);
  }
}
