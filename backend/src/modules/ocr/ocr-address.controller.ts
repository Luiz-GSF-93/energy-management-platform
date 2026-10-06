import {Body,Controller,Get,Header,Param,Post,Req} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../common/constants/permissions';
import {MAP_MANAGE} from '../energy-map/energy-map.validation';
import {OcrAddressService} from './ocr-address.service';
@Controller('documents')
export class OcrAddressController {
 constructor(private service:OcrAddressService){}
 @Get(':id/ocr/address-correction')
 @Header('Cache-Control','private, no-store')
 @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW,PERMISSIONS.ENERGIA_OCR_PROCESS,MAP_MANAGE])
 preview(@Param('id') id:string,@Req() req:any){return this.service.preview(id,req.tenantContext);}
 @Post(':id/ocr/address-correction')
 @Header('Cache-Control','private, no-store')
 @RequirePermission([PERMISSIONS.DOCUMENTS_VIEW,PERMISSIONS.ENERGIA_OCR_PROCESS,MAP_MANAGE])
 save(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.service.save(id,req.tenantContext,body);}
}
