import { Controller, Get, UseGuards } from '@nestjs/common';
import { BackofficeService } from '../services/backoffice.service';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';

@Controller('backoffice')
@UseGuards(JwtAuthGuard)
export class BackofficeController {
  constructor(private readonly backofficeService: BackofficeService) {}

  @Get('dashboard')
  async getDashboard() {
    return this.backofficeService.getDashboard();
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
