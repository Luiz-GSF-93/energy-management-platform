import {elektroIdentityAttestation as attest} from './elektro-identity-confirmation';
import {cpflReference} from './cpfl-measurements';
function fixture(){const c=(key:string,expected:string,text:string,comparison='EQUAL')=>({key,expected,comparison,candidates:[{text,pages:[1],issues:[]}]});return {layoutId:'neoenergia-elektro-verde',registrationAvailable:true,duplicate:false,checks:[c('taxId','12345678001458','CNPJ ********001458','PARTIAL'),c('unit','001','001'),c('address','Rua Um','Rua Um'),c('period','2026-08','Agosto 2026'),c('customer','Company','Company SA','DIFFERENT'),c('market','ACL','Horária Verde','UNKNOWN')]};}
describe('audited Elektro identity',()=>{
 it('offers explicit partial confirmation without fabricating OCR digits',()=>{const p=fixture();expect(attest(p,p.checks[0])).toMatchObject({mode:'MASKED_TAX_ID',visibleSuffix:'001458'});expect(p.checks[0].comparison).toBe('PARTIAL');});
 it.each(['unit','address','period'])('blocks divergent %s',key=>{const p=fixture();p.checks.find(c=>c.key===key)!.comparison='DIFFERENT';expect(attest(p,p.checks[0])).toBeNull();});
 it('rejects suffix mismatch and unsupported layout',()=>{const p=fixture();p.checks[0].expected='12345678999999';expect(attest(p,p.checks[0])).toBeNull();p.layoutId='cpfl-paulista-a';expect(attest(p,p.checks[0])).toBeNull();});
 it('keeps duplicate and uncertain extraction blocked',()=>{const p=fixture();p.duplicate=true;expect(attest(p,p.checks[0])).toBeNull();p.duplicate=false;p.checks[0].candidates[0].pages=[];expect(attest(p,p.checks[0])).toBeNull();});
 it('allows declared name equivalence but not conflicting market',()=>{const p=fixture();expect(attest(p,p.checks[4])?.mode).toBe('NAME_EQUIVALENCE');expect(attest(p,p.checks[5])?.mode).toBe('REGISTERED_MARKET');p.checks[5].candidates[0].text='ACR';expect(attest(p,p.checks[5])).toBeNull();});
 it('parses full competence and preserves abbreviations',()=>{expect(cpflReference('Agosto 2026')).toBe('2026-08');expect(cpflReference('AGO/2026')).toBe('2026-08');expect(cpflReference('Janeiro/2026')).toBe('2026-01');});
});
