import {assessInvoiceIntake,IntakeContext} from './invoice-intake';
const context:IntakeContext={customer:{company_name:'Cliente Teste Ltda',document:'12.345.678/0001-95'},unit:{consumer_unit_number:'001234',address:'Rua Teste, 10',free_market:true},referenceMonth:'2026-08',otherDocumentInPeriod:false};
function fixture(){const raw:any={content:'',pages:[{pageNumber:1}],documents:[{fields:{}}],keyValuePairs:[]};
 const field=(content:string)=>{const offset=raw.content.length;raw.content+=content+'\n';return {content,confidence:0.99,spans:[{offset,length:content.length}],boundingRegions:[{pageNumber:1}]};};
 for(const [name,value] of Object.entries({CustomerName:'Cliente Teste Ltda',CustomerTaxId:'12.345.678/0001-95',ServiceAddress:'Rua Teste, 10',InvoiceId:'123'}))raw.documents[0].fields[name]=field(value);
 for(const [key,value] of [['UC','001234'],['Referência','08/2026'],['Ambiente de contratação','ACL']])raw.keyValuePairs.push({key:field(key),value:field(value),confidence:0.99});
 raw.content+='Energia elétrica TUSD 100 kWh';return raw;
}
const check=(raw:any,field:string,ctx=context)=>assessInvoiceIntake(raw,ctx).checks.find(c=>c.field===field)!;
describe('invoice identity intake',()=>{
 it('never authorizes financial import even with matching identity',()=>{const result=assessInvoiceIntake(fixture(),context);expect(result.canImport).toBe(false);expect(result.decision).toBe('REVIEW_REQUIRED');expect(result.checks.filter(c=>['customer','taxId','unit','address','period','market'].includes(c.field)).every(c=>c.state==='MATCH')).toBe(true);});
 it('does not use vendor CNPJ in place of customer CNPJ',()=>{const raw=fixture();raw.documents[0].fields.VendorTaxId=raw.documents[0].fields.CustomerTaxId;delete raw.documents[0].fields.CustomerTaxId;expect(check(raw,'taxId').state).toBe('REVIEW');});
 it('does not use generic customer id as UC',()=>{const raw=fixture();raw.documents[0].fields.CustomerId=raw.keyValuePairs[0].value;raw.keyValuePairs.shift();expect(check(raw,'unit').state).toBe('REVIEW');});
 it('does not use billing address as service address',()=>{const raw=fixture();raw.documents[0].fields.BillingAddress=raw.documents[0].fields.ServiceAddress;delete raw.documents[0].fields.ServiceAddress;expect(check(raw,'address').state).toBe('REVIEW');});
 it('preserves UC leading zeroes',()=>expect(check(fixture(),'unit',{...context,unit:{...context.unit,consumer_unit_number:'1234'}}).state).toBe('MISMATCH'));
 it('rejects high-confidence CNPJ divergence',()=>expect(assessInvoiceIntake(fixture(),{...context,customer:{...context.customer,document:'11.222.333/0001-81'}}).decision).toBe('REJECT_AUTOMATION'));
 it('does not treat due date or invoice date as reference month',()=>{const raw=fixture();raw.keyValuePairs[1].key.content='Vencimento';raw.documents[0].fields.InvoiceDate=raw.keyValuePairs[1].value;expect(check(raw,'period').state).toBe('REVIEW');});
 it.each(['AGO/2026','Agosto 2026','2026-08'])('parses explicit reference %s',value=>{const raw=fixture();raw.keyValuePairs[1].value.content=value;expect(check(raw,'period').state).toBe('MATCH');});
 it('rejects invalid month',()=>{const raw=fixture();raw.keyValuePairs[1].value.content='13/2026';expect(check(raw,'period').state).toBe('REVIEW');});
 it('requires review for ambiguous repeated UC labels',()=>{const raw=fixture();raw.keyValuePairs.push(raw.keyValuePairs[0]);expect(check(raw,'unit').state).toBe('REVIEW');});
 it.each([0.45,0.85,null])('requires review at confidence %s',confidence=>{const raw=fixture();raw.keyValuePairs[0].confidence=confidence;expect(check(raw,'unit').state).toBe('REVIEW');});
 it('rejects automation below 45%',()=>{const raw=fixture();raw.keyValuePairs[0].confidence=0.44;expect(assessInvoiceIntake(raw,context).decision).toBe('REJECT_AUTOMATION');});
 it('requires page provenance',()=>{const raw=fixture();raw.keyValuePairs[0].value.boundingRegions=[{pageNumber:99}];expect(check(raw,'unit').state).toBe('REVIEW');});
 it('requires span provenance',()=>{const raw=fixture();raw.keyValuePairs[0].value.spans=[{offset:-1,length:6}];expect(check(raw,'unit').state).toBe('REVIEW');});
 it('does not infer ACR from absence of ACL',()=>{const raw=fixture();raw.keyValuePairs.pop();expect(check(raw,'market',{...context,unit:{...context.unit,free_market:false}}).state).toBe('REVIEW');});
 it('flags same unit and month for reissue or duplication review',()=>expect(check(fixture(),'duplicate',{...context,otherDocumentInPeriod:true}).state).toBe('REVIEW'));
 it('missing registration cannot match',()=>{const result=assessInvoiceIntake(fixture(),{...context,customer:null,unit:null});expect(result.checks.filter(c=>['customer','taxId','unit','address','market'].includes(c.field)).every(c=>c.state==='REVIEW')).toBe(true);});
 it('does not certify an arbitrary PDF as electricity invoice',()=>expect(check({content:'Recibo de aluguel',pages:[],documents:[]},'documentType').message).toContain('Não foi possível'));
});
