import {Controller,Get,Post,Req,Res,HttpCode,ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {RawBodyRequest} from '@nestjs/common';
import {Request,Response} from 'express';
import {Public} from '../../common/decorators/public.decorator';
import {PlatformScope} from '../../common/decorators/platform-scope.decorator';
import {RequirePermission} from '../../common/decorators/require-permission.decorator';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {SupabaseService} from '../../services/supabase.service';
import {validSignature,validChallenge,statusEvents} from './whatsapp-delivery';
import {WhatsappTemplatesService} from './whatsapp-templates.service';
import {PLATFORM_SUPPORT_VIEW,TEAM_MANAGE} from '../platform-team/platform-team.permissions';
@Controller('integrations/whatsapp/webhook')
export class WhatsappWebhookController{
 constructor(private readonly db:SupabaseService){}
 @Get() @Public()
 verify(@Req() req:Request,@Res() res:Response){
  if(req.query['hub.mode']!=='subscribe'||!validChallenge(req.query['hub.verify_token'],process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)||typeof req.query['hub.challenge']!=='string'||!/^\d{1,100}$/.test(req.query['hub.challenge']))throw new ForbiddenException('Webhook verification rejected');
  return res.type('text/plain').send(req.query['hub.challenge']);
 }
 @Post() @Public() @HttpCode(200)
 async receive(@Req() req:RawBodyRequest<Request>){
  if(!validSignature(req.rawBody,req.headers['x-hub-signature-256'],process.env.WHATSAPP_APP_SECRET))throw new ForbiddenException('Webhook signature rejected');
  if(!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID||!process.env.WHATSAPP_PHONE_NUMBER_ID)throw new ServiceUnavailableException('Webhook account not configured');
  const events=statusEvents(req.body,process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,process.env.WHATSAPP_PHONE_NUMBER_ID);
  if(events.length){const {error}=await this.db.getClient().from('platform_whatsapp_status_events').upsert(events,{onConflict:'event_key',ignoreDuplicates:true});if(error)throw new ServiceUnavailableException('Webhook persistence unavailable');}
  return {received:true};
 }
}
@Controller('admin/dashboard/whatsapp-delivery') @PlatformScope()
export class WhatsappDeliveryController{
 constructor(private readonly db:SupabaseService){}
 @Get() @RequirePermission([TEAM_MANAGE,PLATFORM_SUPPORT_VIEW])
 async get(){
  const {data,error}=await this.db.getClient().from('platform_whatsapp_status_events').select('message_id,status,event_at,error_codes,received_at').order('received_at',{ascending:false}).limit(20);
  if(error)throw new ServiceUnavailableException('Consulta de entrega indisponível');
  return {configured:!!process.env.WHATSAPP_APP_SECRET&&!!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN&&!!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,events:data};
 }
}
@Controller('admin/dashboard/whatsapp-templates') @PlatformScope()
export class WhatsappTemplatesController{
 constructor(private readonly templates:WhatsappTemplatesService){}
 @Get() @RequirePermission([TEAM_MANAGE,PLATFORM_SUPPORT_VIEW])
 get(){return this.templates.inspect();}
}
