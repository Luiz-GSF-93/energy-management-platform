import {Body,Controller,Get,Param,Post,Req} from '@nestjs/common';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {BotEnergyService} from './bot-energy.service';
@Controller('documents')
export class BotEnergyController {
 constructor(private readonly bot:BotEnergyService){}
 @Get('bot-energy/topics') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 topics(@Req() req:any){return this.bot.topics(req.tenantContext);}
 @Post('bot-energy/help') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 rules(@Req() req:any,@Body() body:unknown){return this.bot.answer(req.tenantContext,body);}
 @Post(':id/ocr/assistant/help') @RequirePermission([P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW])
 context(@Param('id') id:string,@Req() req:any,@Body() body:unknown){return this.bot.answer(req.tenantContext,body,id);}
}
