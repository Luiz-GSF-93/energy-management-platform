import {Body,Controller,Get,Header,Param,Post,Query,Req} from '@nestjs/common';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {RequestWithAuthenticatedUser} from '../../common/interfaces/authenticated-user.interface';
import {SALES_OWNER} from './sales-finance.service';
import {SalesSignatureService} from './sales-signature.service';
import {SalesSignatureDispatchService} from './sales-signature-dispatch.service';
import {SalesSignatureRecoveryService} from './sales-signature-recovery.service';
import {SalesSignatureOriginalService} from './sales-signature-original.service';
import {SalesSignatureAbsenceService} from './sales-signature-absence.service';
@Controller('admin/sales/signatures') @PlatformScope() @RequirePermission([SALES_OWNER])
export class SalesSignatureController {
 constructor(private readonly service:SalesSignatureService,private readonly dispatch:SalesSignatureDispatchService,private readonly recovery:SalesSignatureRecoveryService,private readonly original:SalesSignatureOriginalService,private readonly absence:SalesSignatureAbsenceService){}
 @Get(':id/absence') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') absenceRead(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.absence.read(r.authenticatedUser.userId,id,q);}
 @Post('absence/check') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') absenceCheck(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.absence.check(r.authenticatedUser.userId,b);}
 @Post('absence/authorize') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') absenceAuthorize(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.absence.authorize(r.authenticatedUser.userId,b);}
 @Post('absence/reject') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') absenceReject(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.absence.reject(r.authenticatedUser.userId,b);}
 @Post('absence/execute') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') absenceExecute(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.absence.execute(r.authenticatedUser.userId,b);}
 @Get(':id/original') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') originalRead(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.original.read(r.authenticatedUser.userId,id,q);}
 @Post('original/check') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') originalCheck(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.original.check(r.authenticatedUser.userId,b);}
 @Get(':id/recovery') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') recoveryRead(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string,@Query() q:Record<string,unknown>){return this.recovery.read(r.authenticatedUser.userId,id,q);}
 @Post('recovery/check') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') recoveryCheck(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.recovery.check(r.authenticatedUser.userId,b);}
 @Get(':id/creation') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') creation(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.dispatch.read(r.authenticatedUser.userId,id);}
 @Post('creation/next') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') next(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.dispatch.next(r.authenticatedUser.userId,b);}
 @Get() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') list(@Req() r:RequestWithAuthenticatedUser,@Query() q:Record<string,unknown>){return this.service.list(r.authenticatedUser.userId,q);}
 @Get(':id') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') read(@Req() r:RequestWithAuthenticatedUser,@Param('id') id:string){return this.service.read(r.authenticatedUser.userId,id);}
 @Post() @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') prepare(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.prepare(r.authenticatedUser.userId,b);}
 @Post('withdraw') @RequirePermission([SALES_OWNER]) @Header('Cache-Control','no-store') withdraw(@Req() r:RequestWithAuthenticatedUser,@Body() b:unknown){return this.service.withdraw(r.authenticatedUser.userId,b);}
}
