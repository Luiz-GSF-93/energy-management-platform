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
import { ApprovalsService } from '../services/approvals.service';
import { CreateApprovalDto, UpdateApprovalDto } from '../dtos';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createApprovalDto: CreateApprovalDto, @Req() req: any) {
    const approval = await this.approvalsService.create(createApprovalDto);
    return {
      statusCode: 201,
      message: 'Aprovação criada com sucesso',
      data: approval,
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query('status') status?: string,
    @Query('feeId') feeId?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    let approvals = await this.approvalsService.findAll();

    if (status) {
      approvals = approvals.filter((a) => a.status === status);
    }
    if (feeId) {
      approvals = approvals.filter((a) => a.feeId === feeId);
    }

    return {
      statusCode: 200,
      data: approvals,
      pagination: { page, limit, total: approvals.length },
    };
  }

  @Get('analytics/overview')
  @UseGuards(JwtAuthGuard)
  async getAnalytics() {
    return {
      statusCode: 200,
      data: await this.approvalsService.getAnalytics(),
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string) {
    const approval = await this.approvalsService.findById(id);
    if (!approval) {
      throw new BadRequestException('Aprovação não encontrada');
    }
    return {
      statusCode: 200,
      data: approval,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() updateApprovalDto: UpdateApprovalDto,
  ) {
    const approval = await this.approvalsService.update(
      id,
      updateApprovalDto,
    );
    if (!approval) {
      throw new BadRequestException('Aprovação não encontrada');
    }
    return {
      statusCode: 200,
      message: 'Aprovação atualizada com sucesso',
      data: approval,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const result = await this.approvalsService.delete(id);
    if (!result) {
      throw new BadRequestException('Aprovação não encontrada');
    }
    return {
      statusCode: 204,
      message: 'Aprovação deletada com sucesso',
    };
  }

  @Put(':id/approve')
  @UseGuards(JwtAuthGuard)
  async approve(@Param('id') id: string) {
    const approval = await this.approvalsService.approve(id);
    if (!approval) {
      throw new BadRequestException('Aprovação não encontrada');
    }
    return {
      statusCode: 200,
      message: 'Aprovação confirmada com sucesso',
      data: approval,
    };
  }

  @Put(':id/reject')
  @UseGuards(JwtAuthGuard)
  async reject(@Param('id') id: string, @Body('reason') reason: string) {
    const approval = await this.approvalsService.reject(id, reason);
    if (!approval) {
      throw new BadRequestException('Aprovação não encontrada');
    }
    return {
      statusCode: 200,
      message: 'Aprovação rejeitada com sucesso',
      data: approval,
    };
  }
}
