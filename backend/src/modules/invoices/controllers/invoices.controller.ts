import { Controller, Post, Get, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InvoicesService } from '../services/invoices.service';
import { CreateInvoiceDto, UpdateInvoiceDto, GetInvoicesDto, SimulateRegulatedMarketDto } from '../dtos/invoices.dto';

@Controller('api/v1/invoices')
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  /**
   * POST /api/v1/invoices
   * Criar fatura
   */
  @Post()
  async createInvoice(@Body() dto: CreateInvoiceDto) {
    const userId = 'system'; // Substitua por autenticação real
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

  /**
   * GET /api/v1/invoices
   * Listar faturas
   */
  @Get()
  async getInvoices(
    @Query('organizationId') organizationId: string,
    @Query() filters: GetInvoicesDto,
  ) {
    return await this.invoicesService.getInvoices(organizationId, filters);
  }

  /**
   * GET /api/v1/invoices/:id
   * Obter fatura por ID
   */
  @Get(':id')
  async getInvoiceById(@Param('id') id: string) {
    return await this.invoicesService.getInvoiceById(id);
  }

  /**
   * PUT /api/v1/invoices/:id
   * Atualizar fatura
   */
  @Put(':id')
  async updateInvoice(@Param('id') id: string, @Body() dto: UpdateInvoiceDto) {
    return await this.invoicesService.updateInvoice(id, dto);
  }

  /**
   * POST /api/v1/invoices/:id/compare
   * Comparar fatura com mercado regulado
   */
  @Post(':id/compare')
  async compareWithRegulatedMarket(
    @Param('id') invoiceId: string,
    @Body() dto: SimulateRegulatedMarketDto,
  ) {
    return await this.invoicesService.compareWithRegulatedMarket(invoiceId, dto);
  }

  /**
   * GET /api/v1/invoices/metrics/:consumerUnitId
   * Obter métricas de performance
   */
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
