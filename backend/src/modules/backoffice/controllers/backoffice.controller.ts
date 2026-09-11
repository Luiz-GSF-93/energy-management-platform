import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { BackofficeService } from '../services/backoffice.service';

@Controller('api/v1/backoffice')
@UseGuards(JwtAuthGuard)
export class BackofficeController {
  constructor(private readonly backofficeService: BackofficeService) {}

  @Get('dashboard')
  getDashboard() {
    return this.backofficeService.getDashboardOverview();
  }

  @Get('revenue-report')
  getRevenueReport() {
    return this.backofficeService.getRevenueReport();
  }

  @Get('contract-performance')
  getContractPerformance() {
    return this.backofficeService.getContractPerformance();
  }

  @Get('publication-readiness')
  getPublicationReadiness() {
    return this.backofficeService.getPublicationReadiness();
  }
}
