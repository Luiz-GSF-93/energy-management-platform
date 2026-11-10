import {intakeIdentityDiagnostic} from './automatic-intake-triage';
const c={id:'customer',company_name:'EMPRESA SINTETICA',document:'11222333000181'},u={id:'unit',customer_id:'customer',consumer_unit_number:'1234567',address:'RUA EXEMPLO 123'};
const bill='EMPRESA SINTETICA CNPJ 11.222.333/0002-62\nUC 1234567\nRUA EXEMPLO 123\nReferencia JUL/2026';
describe('same-root triage decisions',()=>{
 it('records the corporate justification instead of rejecting a verified establishment',()=>{const r=intakeIdentityDiagnostic([{page:1,text:bill}],c,u,'a'.repeat(64),'2026-07');expect(r?.fields[0]).toMatchObject({status:'MATCH'});expect(r?.action).not.toBe('REJECT');expect(r?.taxIdentity).toMatchObject({relation:'SAME_ROOT',accepted:true});});
 it('asks for an audited UC decision when root/address/month match but the installation differs',()=>{const r=intakeIdentityDiagnostic([{page:1,text:bill.replace('1234567','7654321')}],c,u,'a'.repeat(64),'2026-07');expect(r).toMatchObject({action:'CONTINUE_JUSTIFIED',unitCode:'7654321'});expect(r?.fields[0].status).toBe('MATCH');});
 it('does not accept a bad checksum as another branch',()=>{expect(intakeIdentityDiagnostic([{page:1,text:bill.replace('0002-62','0002-63')}],c,u,'a'.repeat(64),'2026-07')?.fields[0].status).toBe('MISMATCH');});
});

describe('CPFL recipient address with omitted neighborhood',()=>{
 const unit={...u,address:'AV VINTE E UM DE MARCO, 520 CA A CENTRO'};
 const text='EMPRESA SINTETICA CNPJ 11.222.333/0001-81\nRUA EMITENTE 1632\nAV VINTE E UM DE MARCO 416\nAV VINTE E UM DE MARCO, 520 CA A\nUC 7654321\nReferencia JUL/2026';
 it('allows the audited historical UC decision when the complete installation line matches',()=>{const r=intakeIdentityDiagnostic([{page:1,text}],c,unit,'a'.repeat(64),'2026-07');expect(r?.fields[1].status).toBe('MATCH');expect(r).toMatchObject({action:'CONTINUE_JUSTIFIED',unitCode:'7654321'});});
 it.each(['5200 CA A','520 CA B','520','416 CA A'])('does not accept different number or complement %s',(replacement)=>{const r=intakeIdentityDiagnostic([{page:1,text:text.replace('520 CA A',replacement)}],c,unit,'a'.repeat(64),'2026-07');expect(r?.fields[1].status).not.toBe('MATCH');expect(r?.action).toBe('REVIEW');});
 it('keeps a different competence blocked',()=>{const r=intakeIdentityDiagnostic([{page:1,text:text.replace('JUL/2026','AGO/2026')}],c,unit,'a'.repeat(64),'2026-07');expect(r?.fields[3].status).toBe('MISMATCH');expect(r?.action).toBe('REVIEW');});
});
