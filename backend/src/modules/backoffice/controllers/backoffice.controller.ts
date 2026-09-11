import { Controller, Get } from '@nestjs/common';
import { BackofficeService } from '../services/backoffice.service';

@Controller('api/v1/backoffice')
export class BackofficeController {
  constructor(private readonly backofficeService: BackofficeService) {}

  @Get('dashboard')
  async getDashboard() {
    return this.backofficeService.getDashboardOverview();
  }

  @Get('revenue-report')
  async getRevenueReport() {
    return this.backofficeService.getRevenueReport();
  }

  @Get('contract-performance')
  async getContractPerformance() {
    return this.backofficeService.getContractPerformance();
  }

  @Get('publication-readiness')
  async getPublicationReadiness() {
    return this.backofficeService.getPublicationReadiness();
  }
}
