import {Body,Controller,Header,Headers,HttpCode,Post} from '@nestjs/common';
import {Public} from '../../common/decorators/public.decorator';
import {CoreLicenseService} from './core-license.service';
import {CoreWelcomeService} from './core-welcome.service';
@Controller('integrations/energy-core/licenses')
export class CoreLicenseController{
 constructor(private licenses:CoreLicenseService,private welcomes:CoreWelcomeService){}
 @Post('sync')@Public()@HttpCode(200)@Header('Cache-Control','no-store')sync(@Headers('authorization')token:unknown,@Body()body:unknown){return this.licenses.sync(token,body);}
 @Post('welcome')@Public()@HttpCode(200)@Header('Cache-Control','no-store')welcome(@Headers('authorization')token:unknown,@Body()body:unknown){return this.welcomes.welcome(token,body);}
 @Post('status')@Public()@HttpCode(200)@Header('Cache-Control','no-store')status(@Headers('authorization')token:unknown,@Body()body:unknown){return this.licenses.status(token,body);}
}
