import {identityContinuation,acceptedIdentityContinuation} from './identity-continuation';
import {AutomaticIntakeService} from './automatic-intake.service';
const review={diagnostic:{action:'REVIEW',documentType:'INVOICE_SUPPLIER',fields:[{key:'taxId',status:'MATCH'},{key:'address',status:'MISMATCH',found:['Fiscal street number 900']},{key:'unit',status:'INCONCLUSIVE'},{key:'period',status:'MATCH'}]}};
describe('audited continuation of a specific document',()=>{
 it('exposes the existing address decision only to the organization administrator',()=>{expect(identityContinuation(review,'admin_org')).toBe('ADDRESS');for(const role of ['gestor','operacional','consulta'])expect(identityContinuation(review,role)).toBeNull();});
 it('does not offer address continuation for conflicting unit, CNPJ, period or ambiguous address',()=>{for(const key of ['unit','taxId','period']){const r=structuredClone(review);r.diagnostic.fields.find(f=>f.key===key)!.status='MISMATCH';expect(identityContinuation(r,'admin_org')).toBeNull();}const r=structuredClone(review);r.diagnostic.fields[1].found!.push('Another fiscal street');expect(identityContinuation(r,'admin_org')).toBeNull();});
 it('preserves the existing UC decision',()=>expect(identityContinuation({diagnostic:{action:'CONTINUE_JUSTIFIED'}},'operacional')).toBe('UC'));
 it('routes an administrator address confirmation through the existing audited RPC and rejects other roles',async()=>{const old={...process.env};try{process.env.EVA_AUTOMATIC_INTAKE_ENABLED='true';const rpc=jest.fn(async()=>({data:{id:'saved'}})),s=new AutomaticIntakeService({getClient:()=>({rpc})} as any),t:any={organizationId:'org',userId:'actor',roleId:'role',role:'admin_org'},body={decision:'CONTINUE',continuation:'ADDRESS',fingerprint:'a'.repeat(64),reason:'The administrator confirmed the installation against the original document.'};await s.identityDecision(t,'00000000-0000-4000-8000-000000000001',body);expect(rpc).toHaveBeenCalledWith('eva_intake_identity_action',expect.objectContaining({p_action:'address',p_body:{decision:body.decision,fingerprint:body.fingerprint,reason:body.reason}}));await expect(s.identityDecision({...t,role:'operacional'},'00000000-0000-4000-8000-000000000001',body)).rejects.toThrow('Administrador');}finally{process.env=old;}});
});

it('allows an administrator to review one distributor address only after UC, CNPJ and period match',()=>{
 const r=structuredClone(review);r.diagnostic.documentType='INVOICE_DISTRIBUTOR';r.diagnostic.fields[2].status='MATCH';expect(identityContinuation(r,'admin_org')).toBe('ADDRESS');
 for(const status of ['INCONCLUSIVE','MISMATCH']){r.diagnostic.fields[2].status=status;expect(identityContinuation(r,'admin_org')).toBeNull();}
 r.diagnostic.fields[2].status='MATCH';expect(identityContinuation(r,'gestor')).toBeNull();
});

describe('accepted identity decisions resume the original reading',()=>{
 const fields=[{key:'taxId',status:'MATCH'},{key:'address',status:'MISMATCH'},{key:'unit',status:'INCONCLUSIVE',found:[]},{key:'period',status:'MATCH'}];
 it('honors the source-bound administrator fiscal address decision when a supplier NF does not print the UC',()=>expect(acceptedIdentityContinuation({accepted:true,address:'Fiscal street 416'},{documentType:'INVOICE_SUPPLIER',fields})).toBe(true));
 it('does not apply a missing UC exception to distributor invoices, mismatched UC, tax ID or period',()=>{
  expect(acceptedIdentityContinuation({accepted:true,address:'Fiscal street 416'},{documentType:'INVOICE_DISTRIBUTOR',fields})).toBe(false);
  for(const key of ['taxId','unit','period'])expect(acceptedIdentityContinuation({accepted:true,address:'Fiscal street 416'},{documentType:'INVOICE_SUPPLIER',fields:fields.map(f=>f.key===key?{...f,status:'MISMATCH'}:f)})).toBe(false);
  expect(acceptedIdentityContinuation({accepted:false,address:'Fiscal street 416'},{documentType:'INVOICE_SUPPLIER',fields})).toBe(false);
 });
 it('keeps an accepted historical UC effective when its alias turns the diagnostic into MATCH',()=>{
  const diagnostic={fields:fields.map(f=>f.key==='address'?{...f,status:'MATCH'}:f.key==='unit'?{...f,status:'MATCH',found:['30243386']}:f)};
  expect(acceptedIdentityContinuation({accepted:true,unitCode:'30243386'},diagnostic)).toBe(true);
  expect(acceptedIdentityContinuation({accepted:true,unitCode:'other'},diagnostic)).toBe(false);
 });
});
