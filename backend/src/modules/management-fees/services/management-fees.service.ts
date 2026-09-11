import { Injectable } from '@nestjs/common';

@Injectable()
export class ManagementFeesService {
  private fees: any[] = [];

  async createFee(createFeeDto: any) {
    const fee = {
      id: Math.random().toString(36).substr(2, 9),
      ...createFeeDto,
      createdAt: new Date(),
    };
    this.fees.push(fee);
    return fee;
  }

  async findAllFees() {
    return this.fees;
  }

  async findFeeById(id: string) {
    return this.fees.find(f => f.id === id);
  }

  async findFeesByStatus(status: string) {
    return this.fees.filter(f => f.status === status);
  }

  async findFeesByContract(contractId: string) {
    return this.fees.filter(f => f.contractId === contractId);
  }

  async updateFeeStatus(id: string, updateFeeDto: any) {
    const fee = this.fees.find(f => f.id === id);
    if (fee) {
      fee.status = updateFeeDto.status;
    }
    return fee;
  }

  async getFeesAnalytics() {
    const total = this.fees.length;
    const pending = this.fees.filter(f => f.status === 'PENDING').length;
    const approved = this.fees.filter(f => f.status === 'APPROVED').length;
    const paid = this.fees.filter(f => f.status === 'PAID').length;
    const rejected = this.fees.filter(f => f.status === 'REJECTED').length;

    const totalValue = this.fees.reduce((sum, f) => sum + (f.totalFee || 0), 0);
    const paidValue = this.fees.filter(f => f.status === 'PAID').reduce((sum, f) => sum + (f.totalFee || 0), 0);

    return {
      total,
      pending,
      approved,
      paid,
      rejected,
      totalValue,
      paidValue,
    };
  }
}
