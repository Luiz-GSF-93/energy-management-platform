import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { InvoicesService } from '../services/invoices.service';
import {
  CreateInvoiceDto,
  SimulateRegulatedMarketDto,
  UpdateInvoiceDto,
  GetInvoicesDto,
} from '../dtos/invoices.dto';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Post()
  async createInvoice(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('📄 Criando fatura:', dto.invoiceNumber);
      const invoice = await this.invoicesService.createInvoice(dto, userId);
      return { success: true, data: invoice, message: 'Fatura criada com sucesso' };
    } catch (exception) {
      console.error('❌ Erro ao criar fatura:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Get()
  async getInvoices(@Request() req: any, @Query() filters: GetInvoicesDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('📋 Buscando faturas...');
      const organizationId = 'org-expertev-test-001';
      const invoices = await this.invoicesService.getInvoices(organizationId, filters);
      return { success: true, count: invoices.length, data: invoices };
    } catch (exception) {
      console.error('❌ Erro ao buscar faturas:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Get(':invoiceId')
  async getInvoice(@Request() req: any, @Param('invoiceId') invoiceId: string) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('🔍 Buscando fatura:', invoiceId);
      const invoice = await this.invoicesService.getInvoiceById(invoiceId);
      if (!invoice) throw new BadRequestException('Fatura não encontrada');
      return { success: true, data: invoice };
    } catch (exception) {
      console.error('❌ Erro ao buscar fatura:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Put(':invoiceId')
  async updateInvoice(@Request() req: any, @Param('invoiceId') invoiceId: string, @Body() dto: UpdateInvoiceDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('✏️ Atualizando fatura:', invoiceId);
      const invoice = await this.invoicesService.updateInvoice(invoiceId, dto);
      if (!invoice) throw new BadRequestException('Erro ao atualizar fatura');
      return { success: true, data: invoice, message: 'Fatura atualizada com sucesso' };
    } catch (exception) {
      console.error('❌ Erro ao atualizar fatura:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Post('simulate/regulated-market')
  async simulateRegulatedMarket(@Request() req: any, @Body() dto: SimulateRegulatedMarketDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('⚡ DTO recebido:', JSON.stringify(dto));
      const simulation = await this.invoicesService.simulateRegulatedMarket(dto);
      console.log('⚡ Simulation result:', JSON.stringify(simulation));
      return {
        success: true,
        ...simulation,
        message: 'Simulação realizada com sucesso',
      };
    } catch (exception) {
      console.error('❌ Erro ao simular mercado regulado:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Post(':invoiceId/compare')
  async compareInvoice(@Request() req: any, @Param('invoiceId') invoiceId: string, @Body() body: any) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('⚖️ Comparando fatura com simulação:', invoiceId);
      const simulation = await this.invoicesService.simulateRegulatedMarket(body.simulation);
      const comparison = await this.invoicesService.compareInvoiceWithSimulation(invoiceId, simulation);
      return { success: true, ...comparison, message: 'Comparação realizada com sucesso' };
    } catch (exception) {
      console.error('❌ Erro ao comparar fatura:', exception);
      return { success: false, error: String(exception) };
    }
  }
}
