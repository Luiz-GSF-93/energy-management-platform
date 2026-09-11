import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { ApprovalsService } from '../services/approvals.service';
import { CreateApprovalDto, ApproveApprovalDto } from '../dtos/create-approval.dto';

@Controller('api/v1/approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Post()
  async create(@Body() createApprovalDto: CreateApprovalDto) {
    return this.approvalsService.createApproval(createApprovalDto);
  }

  @Get()
  async findAll() {
    return this.approvalsService.findAllApprovals();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.approvalsService.findApprovalById(id);
  }

  @Put(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() approveDto: ApproveApprovalDto,
  ) {
    return this.approvalsService.approveApproval(id, approveDto);
  }

  @Get('fee/:feeId')
  async getApprovalsByFee(@Param('feeId') feeId: string) {
    return this.approvalsService.findApprovalsByFee(feeId);
  }

  @Get('status/:status')
  async getApprovalsByStatus(@Param('status') status: string) {
    const validStatus = status as 'APPROVED' | 'REJECTED' | 'PENDING_REVIEW';
    return this.approvalsService.findApprovalsByStatus(validStatus);
  }
}
