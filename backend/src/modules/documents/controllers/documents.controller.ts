import { FileInterceptor } from '@nestjs/platform-express';
import { UploadDocumentDto } from '../dto/upload-document.dto';
import { MAX_DOCUMENT_BYTES, DocumentFile } from '../services/document-file';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { DocumentsService } from '../services/documents.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';
import { OrganizationId, UserId } from '../../../common/decorators/tenant.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../../../common/constants/permissions';

@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post()
  @RequirePermission([PERMISSIONS.DOCUMENTS_UPLOAD])
  async create(
    @Body() createDocumentDto: CreateDocumentDto,
    @OrganizationId() organizationId: string,
    @UserId() actorUserId: string,
  ) {
    return this.documentsService.create(createDocumentDto, organizationId, actorUserId);
  }

  @Post('upload')
  @RequirePermission([PERMISSIONS.DOCUMENTS_UPLOAD])
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 6, fieldSize: 8192, parts: 7 } }))
  async upload(@Body() dto: UploadDocumentDto, @UploadedFile() file: DocumentFile,
    @OrganizationId() organizationId: string, @UserId() actorUserId: string) {
    return this.documentsService.upload(dto, file, organizationId, actorUserId);
  }

  @Get(':id/preview')
  @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
  async preview(@Param('id') id: string, @OrganizationId() organizationId: string) {
    return this.documentsService.download(id, organizationId, true);
  }

  @Get(':id/download')
  @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
  async download(@Param('id') id: string, @OrganizationId() organizationId: string) {
    return this.documentsService.download(id, organizationId);
  }

  @Get()
  @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
  async findAll(@OrganizationId() organizationId: string) {
    return this.documentsService.findAll(organizationId);
  }

  @Get(':id')
  @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW])
  async findOne(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.documentsService.findOne(id, organizationId);
  }

  @Put(':id')
  @RequirePermission([PERMISSIONS.DOCUMENTS_UPDATE])
  async update(
    @Param('id') id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.documentsService.update(id, organizationId, updateDocumentDto);
  }

  @Delete(':id')
  @RequirePermission([PERMISSIONS.DOCUMENTS_DELETE])
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.documentsService.delete(id, organizationId);
  }
}
