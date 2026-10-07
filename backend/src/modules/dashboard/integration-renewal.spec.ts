import {renewalStatus,validateRenewal} from './integration-renewal';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {IntegrationRenewalDto} from './integration-renewal.dto';
const base={revision:1,issued_on:'2026-10-07',expires_on:'2026-12-06',no_expiry:false,reminder_days:15};
describe('Integration renewal',()=>{
 it('warns at the threshold and remains current before it',()=>{expect(renewalStatus(base,new Date('2026-11-21T15:00Z')).status).toBe('RENEW_SOON');expect(renewalStatus(base,new Date('2026-11-20T15:00Z')).status).toBe('CURRENT');});
 it('uses the São Paulo date around UTC midnight',()=>{expect(renewalStatus(base,new Date('2026-12-06T01:00Z')).days_remaining).toBe(1);expect(renewalStatus(base,new Date('2026-12-06T03:00Z')).status).toBe('EXPIRED');});
 it('does not invent a date for an unregistered or nonexpiring token',()=>{expect(renewalStatus({...base,issued_on:null,expires_on:null}).status).toBe('NOT_REGISTERED');expect(renewalStatus({...base,no_expiry:true,expires_on:null}).status).toBe('NO_EXPIRY');});
 it('rejects impossible and contradictory dates',()=>{for(const b of [{...base,expires_on:'2026-02-30'},{...base,no_expiry:true},{...base,issued_on:null},{...base,expires_on:base.issued_on}])expect(()=>validateRenewal(b)).toThrow();});
 it('rejects unknown fields such as a token and out of range reminder',async()=>{const errors=await validate(plainToInstance(IntegrationRenewalDto,{...base,reminder_days:0,token:'do-not-store'}),{whitelist:true,forbidNonWhitelisted:true});expect(errors.map(e=>e.property)).toEqual(expect.arrayContaining(['token','reminder_days']));});
});
