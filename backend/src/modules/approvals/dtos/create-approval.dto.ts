export class CreateApprovalDto {
  feeId: string;
  approverName: string;
  approverEmail: string;
}

export class ApproveApprovalDto {
  status: 'APPROVED' | 'REJECTED';
  comments?: string;
}
