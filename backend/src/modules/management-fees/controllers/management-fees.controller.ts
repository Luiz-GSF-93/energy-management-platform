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
import { ManagementFeesService } from '../services/management-fees.service';
import { CreateFeeDto, UpdateFeeDto } from '../dtos';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';

@Controller('fees')
export class ManagementFeesController {
  constructor(private readonly feesService: ManagementFeesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createFeeDto: CreateFeeDto, @Req() req: any) {
    const fee = await this.feesService.create(createFeeDto);
    return {
      statusCode: 201,
      message: 'Taxa criada com sucesso',
      data: fee,
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query('status') status?: string,
    @Query('contractId') contractId?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    let fees = await this.feesService.findAll();

    if (status) {
      fees = fees.filter((f) => f.status === status);
    }
    if (contractId) {
      fees = fees.filter((f) => f.contractId === contractId);
    }

    return {
      statusCode: 200,
      data: fees,
      pagination: { page, limit, total: fees.length },
    };
  }

  @Get('analytics/overview')
  @UseGuards(JwtAuthGuard)
  async getAnalytics() {
    return {
      statusCode: 200,
      data: await this.feesService.getAnalytics(),
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string) {
    const fee = await this.feesService.findById(id);
    if (!fee) {
      throw new BadRequestException('Taxa não encontrada');
    }
    return {
      statusCode: 200,
      data: fee,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() updateFeeDto: UpdateFeeDto,
  ) {
    const fee = await this.feesService.update(id, updateFeeDto);
    if (!fee) {
      throw new BadRequestException('Taxa não encontrada');
    }
    return {
      statusCode: 200,
      message: 'Taxa atualizada com sucesso',
      data: fee,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const result = await this.feesService.delete(id);
    if (!result) {
      throw new BadRequestException('Taxa não encontrada');
    }
    return {
      statusCode: 204,
      message: 'Taxa deletada com sucesso',
    };
  }

  @Put(':id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    const fee = await this.feesService.updateStatus(id, status);
    if (!fee) {
      throw new BadRequestException('Taxa não encontrada');
    }
    return {
      statusCode: 200,
      message: 'Status atualizado com sucesso',
      data: fee,
    };
  }
}
