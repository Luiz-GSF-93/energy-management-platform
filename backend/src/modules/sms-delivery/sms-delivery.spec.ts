import {getExpectedTwilioSignature} from 'twilio';
import {smsReady,smsCallback,smsReceipt,sendSms} from './sms-delivery';
describe('Twilio SMS boundaries',()=>{
 const old={...process.env},id='7f39c52c-4f6d-4d0e-a20f-2390dc38c693',sid='SM'+'1'.repeat(32);
 const env={TWILIO_ACCOUNT_SID:'AC'+'2'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-token',TWILIO_MESSAGING_SERVICE_SID:'MG'+'3'.repeat(32),TWILIO_STATUS_CALLBACK_URL:'https://example.invalid/api/v1/integrations/sms/status',TWILIO_SMS_ENABLED:'true',TWILIO_SENDER_APPROVED:'true'};
 beforeEach(()=>Object.assign(process.env,env));afterEach(()=>process.env={...old});
 it('requires approved sender, enable flag and exact HTTPS callback',()=>{expect(smsReady()).toBe(true);expect(smsReady({...env,TWILIO_SENDER_APPROVED:'false'})).toBe(false);expect(smsReady({...env,TWILIO_STATUS_CALLBACK_URL:'http://example.invalid/api/v1/integrations/sms/status'})).toBe(false);expect(smsReady({...env,TWILIO_STATUS_CALLBACK_URL:env.TWILIO_STATUS_CALLBACK_URL+'?secret=x'})).toBe(false);expect(smsCallback('bad-id')).toBe(null);});
 it('validates every form parameter using the official SDK and canonical public URL',()=>{
  const body={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:sid,MessageStatus:'delivered',FutureField:'supported'},url=smsCallback(id)!;
  const sign=getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,url,body),path='/api/v1/integrations/sms/status?delivery='+id;
  expect(smsReceipt(path,sign,body)).toEqual({deliveryId:id,messageSid:sid,status:'delivered',errorCode:null});
  expect(smsReceipt(path,sign,{...body,MessageStatus:'failed'})).toBe(null);expect(smsReceipt(path+'&x=1',sign,body)).toBe(null);
  const wrong={...body,AccountSid:'AC'+'4'.repeat(32)};expect(smsReceipt(path,getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,url,wrong),wrong)).toBe(null);expect(smsReceipt(path,sign,{...body,FutureField:['invalid']})).toBe(null);expect(smsReceipt(path,undefined,body)).toBe(null);
 });
 it('sends one SMS through the configured service with a delivery-bound callback',async()=>{const transport=jest.fn().mockResolvedValue({ok:true,json:async()=>({sid})});expect(await sendSms(id,'+5516999999999','EnergyOS: teste',transport)).toEqual({state:'ACCEPTED',providerId:sid});const body=new URLSearchParams(transport.mock.calls[0][1].body);expect(body.get('MessagingServiceSid')).toBe(env.TWILIO_MESSAGING_SERVICE_SID);expect(body.get('StatusCallback')).toBe(smsCallback(id));expect(body.get('To')).toBe('+5516999999999');expect(transport).toHaveBeenCalledTimes(1);});
 it('does not retry timeout, rate limit, malformed receipts or rejected recipients',async()=>{const transport=jest.fn().mockRejectedValue(Error('timeout'));expect((await sendSms(id,'+5516999999999','EnergyOS: teste',transport)).state).toBe('UNKNOWN');expect(transport).toHaveBeenCalledTimes(1);transport.mockResolvedValue({ok:false,status:429});expect((await sendSms(id,'+5516999999999','EnergyOS: teste',transport)).state).toBe('UNKNOWN');transport.mockClear();expect((await sendSms(id,'bad','EnergyOS: teste',transport)).reason).toBe('INVALID_DESTINATION');expect(transport).not.toHaveBeenCalled();delete process.env.TWILIO_SENDER_APPROVED;expect((await sendSms(id,'+5516999999999','EnergyOS: teste',transport)).reason).toBe('PROVIDER_NOT_READY');expect(transport).not.toHaveBeenCalled();});
});
