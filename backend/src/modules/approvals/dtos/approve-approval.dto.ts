export class ApproveApprovalDto {
  status: 'APPROVED' | 'REJECTED';
  comments?: string;
}
