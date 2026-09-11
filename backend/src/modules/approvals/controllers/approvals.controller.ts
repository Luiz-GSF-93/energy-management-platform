import { Controller, Get, Post, Body, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ApprovalsService } from '../services/approvals.service';
import { CreateApprovalDto } from '../dtos/create-approval.dto';

@Controller('api/v1/approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  create(@Body() createApprovalDto: CreateApprovalDto) {
    return this.approvalsService.create(createApprovalDto);
  }

  @Get()
  findAll(@Query('status') status?: string) {
    if (status && ['APPROVED', 'REJECTED', 'PENDING_REVIEW'].includes(status)) {
      return this.approvalsService.findByStatus(status as any);
    }
    return this.approvalsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.approvalsService.findOne(id);
  }

  @Get('fee/:feeId')
  getFeeApprovals(@Param('feeId') feeId: string) {
    return this.approvalsService.findByFeeId(feeId);
  }

  @Get('analytics/overview')
  getAnalytics() {
    return this.approvalsService.getAnalytics();
  }

  @Put(':id/approve')
  approve(@Param('id') id: string, @Body('status') status: 'APPROVED' | 'REJECTED', @Body('comments') comments?: string) {
    return this.approvalsService.approve(id, status, comments);
  }
}
