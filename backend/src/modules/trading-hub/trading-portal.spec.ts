import {TradingPortalService} from './trading-portal.service';
import {digest,otpDigest,randomToken,tradingMailConfigured} from './trading-mail';
describe('Trading portal security',()=>{
 const previous={...process.env};
 afterEach(()=>{process.env={...previous};});
 it('stores distinct hashes and binds OTP to the invitation',()=>{process.env.TRADING_PORTAL_SECRET='test-secret-only';const a=randomToken(),b=randomToken();expect(a).toMatch(/^[a-f0-9]{64}$/);expect(a).not.toBe(b);expect(digest(a)).not.toBe(a);expect(otpDigest(a,'123456')).not.toBe(otpDigest(b,'123456'));});
 it('fails closed when the quote sender is absent or uses a different domain',()=>{process.env.RESEND_API_KEY='test';delete process.env.TRADING_EMAIL_FROM;expect(tradingMailConfigured()).toBe(false);process.env.TRADING_EMAIL_FROM='cotacoes@energyos.com.br';expect(tradingMailConfigured()).toBe(false);process.env.TRADING_EMAIL_FROM='cotacoes@cotacoes.expertenergy.com.br';expect(tradingMailConfigured()).toBe(true);});
 it('rejects a missing token before database access',async()=>{const db={getClient:jest.fn()};const service=new TradingPortalService(db as any,{} as any,{} as any);await expect(service.challenge('')).rejects.toThrow();expect(db.getClient).not.toHaveBeenCalled();});
 it.each([null,'2020-01-01T00:00:00Z'])('rejects invalid or expired sessions (%s)',async expiry=>{const q:any={select:jest.fn(),eq:jest.fn(),maybeSingle:jest.fn().mockResolvedValue({data:{state:'PENDING',expires_at:'2099-01-01',session_expires_at:expiry}})};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);const license={requireEntitlement:jest.fn()};const service=new TradingPortalService({getClient:()=>({from:()=>q})} as any,{} as any,license as any);await expect(service.view('a'.repeat(64))).rejects.toThrow();expect(license.requireEntitlement).not.toHaveBeenCalled();});
 it('rejects forged attachment scope before storage access',async()=>{const service=new TradingPortalService({} as any,{} as any,{} as any);jest.spyOn(service as any,'invite').mockResolvedValue({kind:'CLIENT'});await expect(service.upload('a'.repeat(64),{buffer:Buffer.from('%PDF-1.4')})).rejects.toThrow();});
});
