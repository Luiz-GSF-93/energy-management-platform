import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { DocumentsService } from '../services/documents.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';
import { OrganizationId } from '../../../common/decorators/tenant.decorator';
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
  ) {
    return this.documentsService.create(createDocumentDto, organizationId);
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
