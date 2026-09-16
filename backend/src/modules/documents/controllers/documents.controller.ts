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

@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post()
  async create(
    @Body() createDocumentDto: CreateDocumentDto,
    @OrganizationId() organizationId: string,
  ) {
    return this.documentsService.create(createDocumentDto, organizationId);
  }

  @Get()
  async findAll(@OrganizationId() organizationId: string) {
    return this.documentsService.findAll(organizationId);
  }

  @Get(':id')
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
  async delete(
    @Param('id') id: string,
    @OrganizationId() organizationId: string,
  ) {
    return this.documentsService.delete(id, organizationId);
  }
}
