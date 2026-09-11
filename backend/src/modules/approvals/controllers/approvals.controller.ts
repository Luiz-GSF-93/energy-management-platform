import { Controller, Get, Post, Body, Param, Put, UseGuards } from '@nestjs/common';
import { ApprovalsService } from '../services/approvals.service';
import { Approval } from '../repositories/approval.repository';
import { JwtAuthGuard } from '../../../common/guards/jwt.guard';

@Controller('approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  async create(@Body() dto: Partial<Approval>) {
    return this.approvalsService.create(dto);
  }

  @Get()
  async findAll() {
    return this.approvalsService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.approvalsService.findById(id);
  }

  @Get('fee/:feeId')
  async findByFeeId(@Param('feeId') feeId: string) {
    return this.approvalsService.findByFeeId(feeId);
  }

  @Get('status/:status')
  async findByStatus(@Param('status') status: string) {
    return this.approvalsService.findByStatus(status);
  }

  @Put(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { comments?: string }) {
    return this.approvalsService.approve(id, body.comments);
  }

  @Put(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { comments?: string }) {
    return this.approvalsService.reject(id, body.comments);
  }

  @Get('analytics/overview')
  async getAnalytics() {
    return this.approvalsService.getAnalytics();
  }
}
