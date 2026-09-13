export class DocumentEntity {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  filePath: string;
  extractedText: string;
  invoiceNumber: string;
  emissionDate: string;
  referenceMonth: string;
  dueDate: string;
  clientName: string;
  clientCnpj: string;
  distributorName: string;
  consumptionKwh: number;
  totalAmount: number;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'ERROR';
  organizationId: string;
  empresaId: string;
  createdAt: Date;
  updatedAt: Date;
}
