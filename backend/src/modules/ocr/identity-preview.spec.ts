import {identityPreview} from './identity-preview';
const c:any={customer:{company_name:'EMPRESA LTDA',document:'12345678000199'},unit:{consumer_unit_number:'00123',address:'Rua Um 10',free_market:true},referenceMonth:'2026-08',otherDocumentInPeriod:false};
const candidate=(name:string,text:string,confidence:number|null=.99):any=>({name,label:name,source:name,value:{text,confidence,pages:[1],spans:[{offset:0,length:text.length}],issues:[]}});
const layout=():any=>({layoutId:'cpfl-paulista-a',fields:[candidate('customer','EMPRESA LTDA'),candidate('customerTaxId','12.345.678/0001-99'),candidate('unit','00.123'),candidate('serviceAddress','RUA UM 10'),candidate('reference','AGO/2026'),candidate('classification','A4 VERDE LIVRE')]});
describe('current identity comparison',()=>{
 it('compares six fields without approving import',()=>expect(identityPreview(layout(),c)).toMatchObject({matched:6,total:6,canImport:false}));
 it('keeps leading zeroes in UC',()=>{const l=layout();l.fields[2].value.text='123';expect(identityPreview(l,c).checks[2].state).toBe('MISMATCH');});
 it('does not fuzzy-match company names',()=>{const l=layout();l.fields[0].value.text='EMPRESA DE LTDA';expect(identityPreview(l,c).checks[0].state).toBe('MISMATCH');});
 it.each([null,.85,.45,.44])('keeps insufficient field confidence %s in review',v=>{const l=layout();l.fields[0].value.confidence=v;expect(identityPreview(l,c).checks[0]).toMatchObject({state:'REVIEW',comparison:'EQUAL'});});
 it('does not substitute word confidence for field confidence',()=>{const l=layout();l.fields[0].value.confidence=null;l.fields[0].value.transcription={confidence:1};expect(identityPreview(l,c).checks[0].state).toBe('REVIEW');});
 it('blocks absent source',()=>{const l=layout();l.fields[0].value.spans=[];expect(identityPreview(l,c).checks[0].state).toBe('REVIEW');});
 it('shows conflicting candidates',()=>{const l=layout();l.fields.push(candidate('unit','999'));expect(identityPreview(l,c).checks[2].state).toBe('AMBIGUOUS');});
 it('does not use due date as competence',()=>{const l=layout();l.fields=l.fields.filter((f:any)=>f.name!=='reference');l.fields.push(candidate('dueDate','AGO/2026'));expect(identityPreview(l,c).checks[4].state).toBe('MISSING');});
 it('blocks missing registration',()=>expect(identityPreview(layout(),{...c,customer:null}).checks[0].state).toBe('REGISTRATION_MISSING'));
 it('does not compare another layout',()=>expect(identityPreview({...layout(),layoutId:null},c).matched).toBe(0));
 it('does not choose between mixed ACL ACR',()=>{const l=layout();l.fields[5].value.text='ACL ACR';expect(identityPreview(l,c).checks[5].state).toBe('AMBIGUOUS');});
 it('preserves duplicate warning',()=>expect(identityPreview(layout(),{...c,otherDocumentInPeriod:true}).duplicate).toBe(true));
});
