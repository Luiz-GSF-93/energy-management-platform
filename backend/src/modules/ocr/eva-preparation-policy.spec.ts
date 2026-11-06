import {companyTaxIdentity,canContinueWithReservation,preparationPolicy} from './eva-preparation-policy';
const evidence={unit:true,address:true,period:true};
describe('general EVA preparation policy',()=>{
 it('recognizes valid establishments with the same eight-position root, not an arbitrary prefix',()=>{
  expect(companyTaxIdentity('11.222.333/0001-81',['11.222.333/0002-62'],evidence)).toMatchObject({relation:'SAME_ROOT',accepted:true,root:'11222333'});
  expect(companyTaxIdentity('11222333000181',['11222333000182'],evidence).accepted).toBe(false);
  expect(companyTaxIdentity('11222333000181',['00000000000191'],evidence).accepted).toBe(false);
 });
 it.each(['unit','address','period'])('requires independent %s evidence before accepting another establishment',key=>expect(companyTaxIdentity('11222333000181',['11222333000262'],{...evidence,[key]:false}).accepted).toBe(false));
 it('does not choose between recipients or change identifiers',()=>{const found=['11222333000262','00000000000191'];expect(companyTaxIdentity('11222333000181',found,evidence).accepted).toBe(false);expect(found).toHaveLength(2);});
 const row=()=>({acr:'100.00',aclBeforeFees:'80.00',fixedFee:'10.00'});
 const entry=()=>({context:{originalIdentity:{state:'MATCH',fileHash:'a'.repeat(64)},document:{id:'doc',file_hash:'a'.repeat(64)}},comparative:{amount:'100.00',missing:[],invoiceProof:{documentId:'doc',sourceHash:'a'.repeat(64),amount:'70.00'}},plan:{operational:{invoice:{amount:'70.00'}}}});
 it('permits a reservation only with exact identity, amounts and invoice proof',()=>{expect(canContinueWithReservation(row(),entry())).toBe(true);for(const mutate of [(e:any)=>e.context.originalIdentity.state='MISMATCH',(e:any)=>e.comparative.invoiceProof.sourceHash='b'.repeat(64),(e:any)=>e.comparative.missing=['Missing tariff'],(e:any)=>e.plan.operational.invoice.amount='71.00']){const e=entry();mutate(e);expect(canContinueWithReservation(row(),e)).toBe(false);}expect(canContinueWithReservation({...row(),acr:null},entry())).toBe(false);});
 it('continues known fields without presenting missing money as complete, and routes identity to a decision',()=>{
  expect(preparationPolicy({units:[],missing:['Missing money'],financial:{status:'INCOMPLETE'}})).toMatchObject({action:'CONTINUE_AVAILABLE_FIELDS',canContinueFilling:true,financialComplete:false,automaticFinancialApproval:false});
  expect(preparationPolicy({units:[{sources:{identityState:'MISMATCH'}}],missing:[],financial:{status:'INCOMPLETE'}})).toMatchObject({action:'REQUIRES_IDENTITY_DECISION',canContinueFilling:false});
 });
});
