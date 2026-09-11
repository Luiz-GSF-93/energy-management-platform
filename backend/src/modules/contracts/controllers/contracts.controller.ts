import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ContractsService } from '../services/contracts.service';
import { CreateContractDto, UpdateContractDto } from '../dtos';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createContractDto: CreateContractDto,
    @Req() req: any,
  ) {
    if (!createContractDto.contractNumber) {
      throw new BadRequestException('Número do contrato é obrigatório');
    }
    
    const contractData = {
      ...createContractDto,
      startDate: new Date(createContractDto.startDate),
      endDate: createContractDto.endDate ? new Date(createContractDto.endDate) : undefined,
    };

    const contract = await this.contractsService.create(contractData);
    return {
      statusCode: 201,
      message: 'Contrato criado com sucesso',
      data: contract,
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query('status') status?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const contracts = await this.contractsService.findAll();
    const filtered = status
      ? contracts.filter((c) => c.status === status)
      : contracts;

    return {
      statusCode: 200,
      data: filtered,
      pagination: {
        page,
        limit,
        total: filtered.length,
      },
    };
  }

  @Get('analytics/overview')
  @UseGuards(JwtAuthGuard)
  async getAnalytics() {
    return {
      statusCode: 200,
      data: await this.contractsService.getAnalytics(),
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string) {
    const contract = await this.contractsService.findById(id);
    if (!contract) {
      throw new BadRequestException('Contrato não encontrado');
    }
    return {
      statusCode: 200,
      data: contract,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() updateContractDto: UpdateContractDto,
  ) {
    const contractData = {
      ...updateContractDto,
      startDate: updateContractDto.startDate ? new Date(updateContractDto.startDate) : undefined,
      endDate: updateContractDto.endDate ? new Date(updateContractDto.endDate) : undefined,
    };

    const contract = await this.contractsService.update(id, contractData);
    if (!contract) {
      throw new BadRequestException('Contrato não encontrado');
    }
    return {
      statusCode: 200,
      message: 'Contrato atualizado com sucesso',
      data: contract,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const result = await this.contractsService.delete(id);
    if (!result) {
      throw new BadRequestException('Contrato não encontrado');
    }
    return {
      statusCode: 204,
      message: 'Contrato deletado com sucesso',
    };
  }
}
