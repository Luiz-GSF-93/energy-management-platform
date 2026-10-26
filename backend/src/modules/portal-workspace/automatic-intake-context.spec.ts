import {automaticIntakeContext,automaticOcrIdentityConfidence,intakeMonthCandidates,IntakeUnit} from './automatic-intake-context';
const customer={id:'client',document:'11222333000181',company_name:'Empresa sintética'};
const unit={id:'unit',customer_id:'client',consumer_unit_number:'1234567',address:'Rua Exemplo 123'};
const invoice='Empresa sintética CNPJ 11.222.333/0001-81\nUC 1234567\nRua Exemplo 123\nReferência JUL/2026\nEmissão 02/08/2026 Vencimento 10/08/2026';
const nf=`DANFE CNPJ DESTINATÁRIO / REMETENTE
Empresa sintética 11.222.333/0001-81 Rua Exemplo 123
FATURA / DUPLICATAS
Número: 100, Valor original: 300,00, Valor do Desconto: 0,00, Valor Líquido: 300,00
DADOS DO PRODUTO / SERVIÇO
ENERGIA ELETRICA fornecida no mês de maio/2026
27160000 041 6252 MWh 1,5000 200,0000 300,00 0,00
DADOS ADICIONAIS`;
const run=(text=invoice,units:IntakeUnit[]=[unit],hints={})=>automaticIntakeContext([{page:1,text}],customer,units,'a'.repeat(64),hints);
describe('Automatic intake recognition',()=>{
 it('discovers supply month and unit without any selected competence',()=>expect(run()).toMatchObject({state:'MATCH',month:'2026-07',unitId:'unit',documentType:'INVOICE_DISTRIBUTOR'}));
 it('does not substitute issue or due date for supply month',()=>{expect(intakeMonthCandidates('Emissão 02/08/2026 Vencimento 10/08/2026')).toEqual([]);expect(run(invoice.replace('Referência JUL/2026','Emissão 02/08/2026')).state).toBe('REVIEW_REQUIRED');});
 it.each(['month','unit','recipient','address'])('requires a specific review for conflicting %s',kind=>{const t=kind==='recipient'?invoice.replace('11.222.333/0001-81','22.333.444/0001-82'):kind==='address'?invoice.replace('Rua Exemplo 123','Rua Outra 321'):invoice;const hints=kind==='month'?{month:'2026-08'}:kind==='unit'?{unitId:'other'}:{};expect(run(t,[unit],hints).state).toBe('REVIEW_REQUIRED');});
 it('reuses only explicit audited unit aliases',()=>{expect(run(invoice.replace('1234567','7654321')).state).toBe('REVIEW_REQUIRED');expect(run(invoice.replace('1234567','7654321'),[{...unit,aliases:['7654321']}]).state).toBe('MATCH');});
 it('never selects one of two units having the same registration',()=>expect(run(invoice,[unit,{...unit,id:'other'}]).state).toBe('REVIEW_REQUIRED'));
 it('classifies the supplier NF and its supplied month instead of requiring a previous contract insertion',()=>expect(run(nf)).toMatchObject({state:'MATCH',documentType:'INVOICE_SUPPLIER',month:'2026-05'}));
 it('requires recipient evidence for multiple authorized units',()=>{const units=[unit,{...unit,id:'second',address:'Rua Outra 123'}];expect(run(nf,units)).toMatchObject({state:'MATCH',unitId:'unit'});expect(run(nf.replace('Rua Exemplo 123',''),units).state).toBe('REVIEW_REQUIRED');});
 it('does not classify a contract as an invoice',()=>expect(run('CONTRATO CONTRATANTE CLAUSULA Referência JUL/2026')).toMatchObject({state:'REVIEW_REQUIRED'}));
 it('rejects a mixed customer scope rather than choosing its first unit',()=>expect(run(invoice,[{...unit,customer_id:'foreign'}]).state).toBe('REVIEW_REQUIRED'));
 it.each([undefined,0.5,0.85])('does not turn missing/low OCR confidence into automatic identity: %s',confidence=>{const raw={pages:[{words:invoice.split(/\s/).map(content=>({content,confidence}))}]};expect(automaticOcrIdentityConfidence(raw,run(),customer,unit)).toBe(false);});
 it('accepts original OCR words only when the identity tokens are sourced with adequate confidence',()=>{const raw={pages:[{words:invoice.split(/\s/).map(content=>({content,confidence:0.99}))}]};expect(automaticOcrIdentityConfidence(raw,run(),customer,unit)).toBe(true);});
 it('can resolve a genuine ambiguity by rechecking the selected match, without overriding a mismatch',()=>{expect(run(invoice,[unit,{...unit,id:'second'}],{unitId:'second'})).toMatchObject({state:'MATCH',unitId:'second'});expect(run(invoice,[unit],{unitId:'nonexistent'}).state).toBe('REVIEW_REQUIRED');});
});
