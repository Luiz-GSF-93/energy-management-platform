import {registeredManagementContracts,selectAutofillLibrary,FillField} from './calculation-autofill.model';
import {feeCents,feeMoney,allocationUnits} from '../contracts/services/management-fee';

/** Independently known register values remain visible when the monthly invoice is
 * unavailable. This is a partial view, never a substitute for billing evidence. */
export function registeredClosingSources(unit:any,month:string,sources:any){
 const tables=sources?.financial?.tables??{},fields:FillField[]=[];
 const add=(key:string,label:string,value:unknown,measure:string,scenario:string,source:string)=>fields.push({key,label,value,unit:measure,scenario,source,state:'FILLED',observation:'Cadastro vigente da competência; valores finais dependem das evidências mensais.'});
 const matches=registeredManagementContracts({unit,month,captured:{management:tables.management_contracts??[],adjustments:tables.commercial_fee_adjustments??[]}});
 const contract=matches.length===1?matches[0]:null;
 let fixedFee:any=null;
 if(contract&&['FIXED','HYBRID'].includes(contract.remuneration_model)){
  const source='Contrato de gestão '+contract.id+(contract.fee_adjustment?' · reajuste '+contract.fee_adjustment.id:'');
  if(!contract.fee_adjustment_pending&&contract.fixed_fee_monthly!==null&&contract.fixed_fee_monthly!==undefined)try{
   const amount=feeCents(contract.fixed_fee_monthly);if(amount<0n)throw Error();
   fixedFee={amount:feeMoney(amount),source};add('fee:fixed','Honorário fixo por unidade',fixedFee.amount,'BRL','ACL',source);
  }catch{/* Invalid register data remains unavailable. */}
  if(contract.remuneration_model==='HYBRID'&&contract.savings_percentage!==null&&contract.savings_percentage!==undefined)try{
   const percentage=String(contract.savings_percentage);allocationUnits(percentage);add('fee:percentage','Honorário variável',percentage,'%','ACL',source);
  }catch{/* Do not invent a contractual percentage. */}
 }
 const library=selectAutofillLibrary(sources?.libraries??[],unit,month).record;
 if(library)for(const item of library.profile.items)add('ACR:'+item.component+':'+item.band,item.label,item.value,item.measure,'ACR','Biblioteca '+library.id+' v'+library.version+' · '+library.profile.source);
 return {fields,library:library?{id:library.id,version:library.version}:null,operational:{state:'UNAVAILABLE',fixedFee},financialApproval:false,readyForValidation:false,canPublish:false};
}
