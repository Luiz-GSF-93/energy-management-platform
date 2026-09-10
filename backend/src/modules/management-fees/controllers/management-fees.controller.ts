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
import { ManagementFeesService } from '../services/management-fees.service';
import {
  CreateManagementContractDto,
  CalculateFeeDto,
  CompareFeeDto,
  ApproveFeeDto,
  GetFeesDto,
  UpdateManagementContractDto,
} from '../dtos/management-fees.dto';

@Controller('management-fees')
@UseGuards(JwtAuthGuard)
export class ManagementFeesController {
  constructor(private managementFeesService: ManagementFeesService) {}

  @Post('contracts')
  async createManagementContract(@Request() req: any, @Body() dto: CreateManagementContractDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('📜 Criando contrato de gestão');
      const contract = await this.managementFeesService.createManagementContract(dto, userId);
      return { success: true, data: contract, message: 'Contrato criado com sucesso' };
    } catch (exception) {
      console.error('❌ Erro ao criar contrato:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Post('calculate')
  async calculateFee(@Request() req: any, @Body() dto: CalculateFeeDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('💰 Calculando honorário');
      const fee = await this.managementFeesService.calculateFee(dto, userId);
      return { success: true, data: fee, message: 'Honorário calculado com sucesso' };
    } catch (exception) {
      console.error('❌ Erro ao calcular honorário:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Post('compare-scenarios')
  async compareScenarios(@Request() req: any, @Body() dto: CompareFeeDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      console.log('⚖️ Comparando cenários de remuneração');
      const comparison = await this.managementFeesService.compareFeeScenarios(dto);
      return { success: true, data: comparison, message: 'Comparação realizada com sucesso' };
    } catch (exception) {
      console.error('❌ Erro ao comparar cenários:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Post(':feeId/approve')
  async approveFee(@Request() req: any, @Param('feeId') feeId: string, @Body() dto: ApproveFeeDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      dto.feeCalculationId = feeId;
      console.log('✅ Aprovando honorário');
      const fee = await this.managementFeesService.approveFee(dto, userId);
      return { success: true, data: fee, message: 'Honorário aprovado com sucesso' };
    } catch (exception) {
      console.error('❌ Erro ao aprovar honorário:', exception);
      return { success: false, error: String(exception) };
    }
  }

  @Get()
  async listFees(@Request() req: any, @Query() filters: GetFeesDto) {
    try {
      const userId = req.user?.sub;
      if (!userId) throw new BadRequestException('Usuário não autenticado');
      const organizationId = 'org-expertev-test-001';
      console.log('📋 Listando honorários');
      const fees = await this.managementFeesService.listFees(organizationId, filters);
      return { success: true, count: fees.length, data: fees };
    } catch (exception) {
      console.error('❌ Erro ao listar honorários:', exception);
      return { success: false, error: String(exception) };
    }
  }
}
