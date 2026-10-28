import {InternalServerErrorException} from '@nestjs/common';
import {aggregate,cents} from './published-financial-summary';
import {feeMoney} from './management-fee';
/** Authorized-unit read projection, after integrity verification of the full
 * immutable publication. Never writes a financial amount or published source. */
export function portalPublicationUnits(publication:any,allowed:string[]) {
 const units=publication.financial.units.filter((u:any)=>allowed.includes(u.id));
 if(!units.length)return null;
 const rows=units.map((u:any)=>{
  const savingsBeforeFees=feeMoney(cents(u.acr)-cents(u.aclBeforeFees));
  if(cents(u.acr)-cents(u.aclAfterFees)!==cents(u.savingsAfterFees,true)||cents(u.aclBeforeFees)+cents(u.totalFees)!==cents(u.aclAfterFees))throw new InternalServerErrorException('Valores publicados da unidade não conciliados.');
  return {acr:u.acr,aclBeforeFees:u.aclBeforeFees,totalFees:u.totalFees,aclAfterFees:u.aclAfterFees,savingsBeforeFees,savingsAfterFees:u.savingsAfterFees,savingsPercent:null};
 });
 return {...publication,financial:{status:'AVAILABLE',...aggregate(rows),units},preparations:{},scope:'AUTHORIZED_UNITS'};
}
