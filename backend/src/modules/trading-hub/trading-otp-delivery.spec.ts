import {Logger} from '@nestjs/common';
import {TradingPortalService} from './trading-portal.service';
import * as mail from './trading-mail';

describe('Trading OTP delivery feedback and audit',()=>{
 const env={...process.env},token='a'.repeat(64);
 const invitation={id:'invite',organization_id:'org',email:'person@example.test',opportunityTitle:'Synthetic\nquotation',expires_at:'2099-01-01T00:00:00Z'};
 beforeEach(()=>{process.env.TRADING_RESEND_API_KEY='synthetic-only';process.env.TRADING_EMAIL_FROM='cotacoes@cotacoes.expertenergy.com.br';process.env.TRADING_PORTAL_SECRET='synthetic-secret';});
 afterEach(()=>{process.env={...env};jest.restoreAllMocks();});
 function setup(){const rpc=jest.fn().mockResolvedValue({data:true}),s=new TradingPortalService({getClient:()=>({rpc})} as any,{} as any,{} as any);jest.spyOn(s as any,'invite').mockResolvedValue({...invitation});const audit=jest.spyOn(s as any,'audit').mockResolvedValue(undefined);return {s,rpc,audit};}
 it('returns only masked destination and timing after provider acceptance, without recording code, token or message body',async()=>{
  const {s,rpc,audit}=setup(),send=jest.spyOn(mail,'sendTradingMail').mockResolvedValue('provider-id');
  const result=await s.challenge(token);
  expect(result).toMatchObject({sent:true,emailHint:'pe***@example.test',resendAfterSeconds:60});
  expect(Date.parse(result.expiresAt)-Date.now()).toBeLessThanOrEqual(600000);
  expect(rpc).toHaveBeenCalledWith('trading_otp_challenge',{p_hash:mail.digest(token),p_otp:expect.stringMatching(/^[a-f0-9]{64}$/)});
  expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][1]).toBe('EnergyOS — código de acesso · Synthetic quotation');
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({id:'invite'}),'OTP_EMAIL_ACCEPTED',{state:'ACCEPTED',messageId:'provider-id',httpStatus:200,code:null});
  const response=JSON.stringify(result),details=JSON.stringify(audit.mock.calls[0][2]);
  expect(response).not.toContain(invitation.email);for(const value of [token,'synthetic-secret',send.mock.calls[0][2]])expect(response+details).not.toContain(value);
 });
 it('does not reserve or send when the dedicated sender is unavailable',async()=>{const {s,rpc,audit}=setup(),send=jest.spyOn(mail,'sendTradingMail');delete process.env.TRADING_RESEND_API_KEY;await expect(s.challenge(token)).rejects.toThrow('remetente');expect(rpc).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(audit).not.toHaveBeenCalled();});
 it('does not send after the database cooldown or daily limit rejects the request',async()=>{const {s,rpc,audit}=setup(),send=jest.spyOn(mail,'sendTradingMail');rpc.mockResolvedValue({data:false});await expect(s.challenge(token)).rejects.toThrow('10 pedidos');expect(send).not.toHaveBeenCalled();expect(audit).not.toHaveBeenCalled();});
 it.each(['REJECTED','UNKNOWN'] as const)('records a sanitized %s provider outcome and never reports success',async state=>{const {s,audit}=setup();const error=new mail.TradingMailError(state,state==='REJECTED'?'HTTP_403':'NETWORK_UNCONFIRMED',state==='REJECTED'?403:null);jest.spyOn(mail,'sendTradingMail').mockRejectedValue(error);await expect(s.challenge(token)).rejects.toBe(error);expect(audit).toHaveBeenCalledWith(expect.anything(),'OTP_EMAIL_'+state,{state,httpStatus:error.httpStatus,code:error.diagnosticCode});});
 it('does not tell the supplier to resend a successfully accepted code merely because audit acknowledgement failed',async()=>{const {s,audit}=setup(),warn=jest.spyOn(Logger.prototype,'warn').mockImplementation(()=>undefined);audit.mockRejectedValue(new Error('Database acknowledgement unavailable'));jest.spyOn(mail,'sendTradingMail').mockResolvedValue('provider-id');await expect(s.challenge(token)).resolves.toMatchObject({sent:true});expect(warn).toHaveBeenCalledTimes(1);expect(JSON.stringify(warn.mock.calls)).not.toContain(token);});
 it('keeps the invitation deadline shorter than the normal code lifetime',async()=>{const {s}=setup(),expires=new Date(Date.now()+30000).toISOString();jest.spyOn(s as any,'invite').mockResolvedValue({...invitation,expires_at:expires});jest.spyOn(mail,'sendTradingMail').mockResolvedValue('provider-id');expect((await s.challenge(token)).expiresAt).toBe(expires);});
 it('keeps expired or revoked invitations rejected before attempting delivery',async()=>{const {s,rpc}=setup(),send=jest.spyOn(mail,'sendTradingMail');jest.spyOn(s as any,'invite').mockRejectedValue(new Error('Convite expirado ou revogado'));await expect(s.challenge(token)).rejects.toThrow('revogado');expect(rpc).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();});
});
