import { Controller, Get, Post, Body, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ApprovalsService } from '../services/approvals.service';
import { CreateApprovalDto } from '../dtos/create-approval.dto';
import { ApproveApprovalDto } from '../dtos/approve-approval.dto';

@Controller('api/v1/approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  async create(@Body() createApprovalDto: CreateApprovalDto) {
    return this.approvalsService.createApproval(createApprovalDto);
  }

  @Get()
  async findAll(@Query('status') status?: string) {
    if (status && ['APPROVED', 'REJECTED', 'PENDING_REVIEW'].includes(status)) {
      return this.approvalsService.findApprovalsByStatus(status as any);
    }
    return this.approvalsService.findAllApprovals();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.approvalsService.findApprovalById(id);
  }

  @Get('fee/:feeId')
  async getFeeApprovals(@Param('feeId') feeId: string) {
    return this.approvalsService.findApprovalsByFee(feeId);
  }

  @Get('analytics/overview')
  async getAnalytics() {
    return this.approvalsService.getApprovalsAnalytics();
  }

  @Put(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() approveApprovalDto: ApproveApprovalDto,
  ) {
    return this.approvalsService.approveApproval(id, approveApprovalDto);
  }
}
