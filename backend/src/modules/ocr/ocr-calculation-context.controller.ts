import {Controller,Get,Param,Req} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {OcrCalculationContextService} from './ocr-calculation-context.service';
@Controller('documents')
export class OcrCalculationContextController {
 constructor(private service:OcrCalculationContextService){}
 @Get(':id/ocr/calculation-context') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 inspect(@Param('id') id:string,@Req() req:any){return this.service.inspect(id,req.tenantContext);}
}
