import {Body,Controller,Get,Header,Post,Req} from '@nestjs/common';
import {RequestWithTenant} from '../../common/interfaces/tenant-context.interface';
import {TrainingService} from './training.service';
@Controller('training/ccee')
export class TrainingController{
 constructor(private readonly training:TrainingService){}
 @Get() @Header('Cache-Control','private, no-store') state(@Req() req:RequestWithTenant){return this.training.state(req);}
 @Post('progress') @Header('Cache-Control','private, no-store') progress(@Req() req:RequestWithTenant,@Body() body:unknown){return this.training.command(req,body);}
 @Post('media') @Header('Cache-Control','private, no-store') media(@Req() req:RequestWithTenant,@Body() body:unknown){return this.training.media(req,body);}
}
