import {supplierIcmsAmount} from './supplier-icms';
import {MonthlyCostsPayloadDto} from '../dto/monthly-costs.dto';
export function normalizeCosts(c:MonthlyCostsPayloadDto){return {noCosts:c.noCosts,items:c.items.map(i=>({...i,label:i.label.trim(),source:i.source.trim()}))};}
export function costIssues(c:MonthlyCostsPayloadDto,validating=false){const issues:string[]=[];
 for(const item of c.items){
  if(item.category==='DISTRIBUTOR_ADJUSTMENT'&&(item.scenario!=='ACL'||item.taxTreatment!=='INCLUDED'))issues.push('Ajuste da distribuidora exige ACL e valor final documentado.');
  if(item.supplierIcms){
   if(item.category!=='SUPPLIER_INVOICE'||item.scenario!=='ACL'||item.effect!=='COST'||item.taxTreatment!=='RESERVED')issues.push('ICMS adicional exige nota do fornecedor ACL com ressalva dos demais tributos, sem ICMS já embutido.');
   try{supplierIcmsAmount(item.amount,item.supplierIcms);}catch(e){issues.push(e instanceof Error?e.message:'Revise o ICMS do fornecedor.');}
  }
 }

 if(c.items.some(i=>i.taxTreatment==='RESERVED'&&(i.category!=='SUPPLIER_INVOICE'||i.scenario!=='ACL'||i.effect!=='COST'||(i.taxReservationReason?.trim().length??0)<20)))issues.push('Ressalva tributária exige fatura do fornecedor ACL, custo e justificativa de pelo menos 20 caracteres.');
 if(c.items.some(i=>i.taxTreatment!=='RESERVED'&&i.taxReservationReason!==undefined))issues.push('A justificativa tributária específica deve acompanhar somente o tratamento com ressalva.');
 if(c.items.some(i=>['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(i.category)&&i.scenario!=='ACL'))issues.push('Fatura do fornecedor e compra extra pertencem ao cenário ACL.');
 if(new Set(c.items.map(i=>i.id)).size!==c.items.length)issues.push('Cada lançamento deve possuir identificador único.');
 if(c.noCosts&&c.items.length)issues.push('Remova os lançamentos ou desmarque a declaração de ausência de custos.');
 if(validating&&!c.noCosts&&!c.items.length)issues.push('Cadastre os custos/créditos ou declare a ausência após revisão.');
 if(validating&&c.items.some(i=>i.taxTreatment==='UNSPECIFIED'))issues.push('Informe o tratamento tributário de todos os lançamentos antes de validar.');
 return issues;
}
