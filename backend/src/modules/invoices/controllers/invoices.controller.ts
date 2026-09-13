import { Controller, Post, Get, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InvoicesService } from '../services/invoices.service';
import { CreateInvoiceDto, UpdateInvoiceDto, GetInvoicesDto, SimulateRegulatedMarketDto } from '../dtos/invoices.dto';

@Controller('invoices')
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Post()
  async createInvoice(@Body() dto: CreateInvoiceDto) {
    const userId = 'system';
    return await this.invoicesService.createInvoiceFromContract(
      dto.energyContractId,
      dto.consumerUnitId,
      new Date(dto.referenceMonth),
      {
        kwhPeak: dto.consumptionKwhPeak,
        kwhOffPeak: dto.consumptionKwhOffPeak,
        demandKwPeak: dto.demandKwPeak,
        demandKwOffPeak: dto.demandKwOffPeak,
        demandKwBilled: dto.demandKwBilled,
        chargesCost: dto.chargesCost,
        municipalTax: dto.municipalTax,
      },
      userId,
    );
  }

  @Get()
  async getInvoices(
    @Query('organizationId') organizationId: string,
    @Query() filters: GetInvoicesDto,
  ) {
    return await this.invoicesService.getInvoices(organizationId, filters);
  }

  @Get(':id')
  async getInvoiceById(@Param('id') id: string) {
    return await this.invoicesService.getInvoiceById(id);
  }

  @Put(':id')
  async updateInvoice(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return await this.invoicesService.updateInvoice(id, dto);
  }

  @Post(':id/compare')
  async compareWithRegulatedMarket(
    @Param('id') invoiceId: string,
    @Body() dto: SimulateRegulatedMarketDto,
  ) {
    return await this.invoicesService.compareWithRegulatedMarket(invoiceId, dto);
  }

  @Get('metrics/:consumerUnitId')
  async getPerformanceMetrics(
    @Param('consumerUnitId') consumerUnitId: string,
    @Query('organizationId') organizationId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return await this.invoicesService.getPerformanceMetrics(
      consumerUnitId,
      organizationId,
      new Date(startDate),
      new Date(endDate),
    );
  }
}
