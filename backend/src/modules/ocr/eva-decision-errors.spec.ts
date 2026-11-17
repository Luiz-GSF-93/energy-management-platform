import {EvaAssistedClosingService} from './eva-assisted-closing.service';
describe('EVA closing decision diagnostics',()=>{
 const context:any={organizationId:'org',userId:'actor',roleId:'admin_org',accessMode:'organization'};
 const scope={consumerUnitId:'unit',month:'2026-08',scopeKind:'UNIT'};
 const invoke=(error:any)=>{
  const service=new EvaAssistedClosingService({getClient:()=>({rpc:jest.fn().mockResolvedValue({error})})} as any,{get:()=> 'true'} as any,{} as any);
  return (service as any).rpc('decide',scope,context,'closing',{decision:'APPROVE'});
 };
 it('explains a consolidated fee requirement without exposing SQL',async()=>{
  await expect(invoke({code:'22023',message:'Shared variable fee requires consolidated closing'})).rejects.toMatchObject({response:{code:'EVA_UNIT_FEE_REQUIRES_CONSOLIDATION',stage:'decide',message:expect.stringContaining('regra mensal')}});
 });
 it('gives scope recovery instructions',async()=>{
  await expect(invoke({code:'22023',message:'Report scope mismatch'})).rejects.toMatchObject({response:{code:'EVA_CLOSING_SCOPE_MISMATCH',message:expect.stringContaining('escopo')}});
 });
 it('never returns unknown database details',async()=>{
  try{await invoke({code:'22023',message:'PRIVATE_INTERNAL_SQL_AND_CUSTOMER'});throw Error('Expected rejection');}catch(e:any){expect(e.response.code).toBe('EVA_CLOSING_DECISION_INVALID');expect(JSON.stringify(e.response)).not.toContain('PRIVATE_INTERNAL');expect(e.response.message).toContain('preenchimentos foram preservados');}
 });
 it('preserves authorization and concurrency errors',async()=>{
  await expect(invoke({code:'42501'})).rejects.toMatchObject({status:403});
  await expect(invoke({code:'40001'})).rejects.toMatchObject({status:409});
 });
});
