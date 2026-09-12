export class UploadResponseDto {
  success: boolean;
  documentId: string;
  extractionId: string;
  status: string;
  extraction?: any;
  message: string;
}
