import {documentedInvoiceProposalReady} from './eva-global-model';
function fixture(){
 const raw:any={content:'',pages:[{pageNumber:1}]};
 const field=(text:string,decimal?:string)=>{const offset=raw.content.length;raw.content+=text+'\n';return {text,decimal,confidence:.99,pages:[1],spans:[{offset,length:text.length}],issues:[]};};
 const row:any={source:'table.row1',component:'PUBLIC_LIGHTING',role:'CHARGE',issues:[],fields:{description:field('Contribuição Custeio IP-CIP'),amount:field('10,00','10.00')}};
 const total:any={source:'table.total',component:'TOTAL_A_PAGAR',role:'TOTAL',fields:{description:field('Total a Pagar'),amount:field('10,00','10.00')}};
 const layout:any={operations:[row,total],reconciliation:{state:'MATCH'},taxReconciliation:{checks:['icmsAmount','pisAmount','cofinsAmount'].map(key=>({key,state:'MATCH_EXTRACTED',declared:'1.00',extracted:'1.00'}))}};
 return {raw,layout,identity:{state:'MATCH',fileHash:'a'.repeat(64)}};
}
describe('Source-backed financial proposal without generic OCR identity fields',()=>{
 const old=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
 beforeEach(()=>process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true');
 afterAll(()=>{if(old===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=old;});
 it('allows a draft only from independent original identity and complete financial proof, preserving source',()=>{const x=fixture(),before=JSON.stringify(x);expect(documentedInvoiceProposalReady(x.raw,x.layout,x.identity)).toBe(true);expect(JSON.stringify(x)).toBe(before);});
 it.each(['identity','hash','reconciliation','tax','tax-value','amount','span','confidence','unknown','duplicate','total','feature'])('does not permit uncertain or disabled evidence: %s',kind=>{
 const x=fixture();if(kind==='identity')x.identity.state='REVIEW';if(kind==='hash')x.identity.fileHash='bad';if(kind==='reconciliation')x.layout.reconciliation.state='DIVERGENT';if(kind==='tax')x.layout.taxReconciliation.checks.pop();if(kind==='tax-value')x.layout.taxReconciliation.checks[0].extracted='1.01';if(kind==='amount')x.layout.operations[0].fields.amount.decimal=null;if(kind==='span')x.layout.operations[0].fields.amount.spans=[{offset:-1,length:3}];if(kind==='confidence')x.layout.operations[0].fields.amount.confidence=.85;if(kind==='unknown')x.layout.operations[0].role='UNKNOWN';if(kind==='duplicate')x.layout.operations.push(x.layout.operations[0]);if(kind==='total')x.layout.operations.push(x.layout.operations[1]);if(kind==='feature')process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='false';
 expect(documentedInvoiceProposalReady(x.raw,x.layout,x.identity)).toBe(false);
 });
});
