import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Query } from '@nestjs/common';
import { DocumentsService } from '../services/documents.service';
import { CreateDocumentDto, UpdateDocumentDto } from '../dto/create-document.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post()
  create(@Body() createDocumentDto: CreateDocumentDto) {
    return this.documentsService.create(createDocumentDto);
  }

  @Get()
  findByCustomer(@Query('customerId') customerId: string) {
    return this.documentsService.findByCustomer(customerId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateDocumentDto: UpdateDocumentDto) {
    return this.documentsService.update(id, updateDocumentDto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.documentsService.delete(id);
  }
}
