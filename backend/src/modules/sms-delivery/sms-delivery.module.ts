import {Controller,Post,Req,HttpCode,ForbiddenException,ServiceUnavailableException,Module} from '@nestjs/common';
import {Request} from 'express';
import {Public} from '../../common/decorators/public.decorator';
import {SupabaseService} from '../../services/supabase.service';
import {smsReceipt} from './sms-delivery';
@Controller('integrations/sms/status')
export class SmsStatusController{
 constructor(private db:SupabaseService){}
 @Post() @Public() @HttpCode(204)
 async receive(@Req() req:Request){
  const receipt=smsReceipt(req.originalUrl,req.headers['x-twilio-signature'],req.body);if(!receipt)throw new ForbiddenException('SMS signature rejected');
  const {error}=await this.db.getClient().rpc('record_sms_receipt',{p_delivery:receipt.deliveryId,p_message:receipt.messageSid,p_status:receipt.status,p_error:receipt.errorCode});
  if(error)throw new ServiceUnavailableException('SMS persistence unavailable');
 }
}
@Module({controllers:[SmsStatusController],providers:[SupabaseService]})
export class SmsDeliveryModule{}
