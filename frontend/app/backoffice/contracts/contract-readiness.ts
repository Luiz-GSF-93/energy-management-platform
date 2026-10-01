import type {Result} from './CalculationPreparation';
import type {Unit} from './types';
export type ReadinessStage={id:string;label:string;passed:number;total:number;percent:number;pending:string[]};
export function contractReadiness(unit:Unit,r:Result|null){
 const stage=(id:string,label:string,checks:[string,boolean][]):ReadinessStage=>{const pending=checks.filter(([,ok])=>!ok).map(([label])=>label);return{id,label,passed:checks.length-pending.length,total:checks.length,percent:Math.floor(100*(checks.length-pending.length)/checks.length),pending};};
 const noIssue=(sections:string[])=>!!r&&!r.findings.some(f=>sections.includes(f.section)&&f.severity==='BLOCKER');
 const stages=[
 stage('distributor','Distribuidora e unidade',[[ 'Identificar unidade e distribuidora',!!unit.consumer_unit_number&&!!unit.distributor],['Definir grupo e subgrupo',!!unit.tariff_group&&!!unit.tariff_subgroup],['Definir modalidade e classe',!!unit.tariff_modality&&!!unit.consumption_class],['Definir mercado ACL/ACR',typeof unit.free_market==='boolean'],['Conferir cadastro na competência',noIssue(['Unidade'])]]),
 stage('supply','Fornecedor Mercado Livre',[['Contrato com cobertura do mês',!!r?.suppliers.length&&r.suppliers.every(s=>!s.priceCoverage.gaps.length&&!s.priceCoverage.overlap)],['Preço e faturamento conferidos',r?.contractSupplierCost?.status==='READY'],['Resolver pendências do fornecedor',noIssue(['Fornecedor','Preços','Volumes'])]]),
 stage('management','Honorários da gestão',[['Contrato de honorários',!!r?.managementFeeMemory?.contract],['Condições mensais conferidas',!!r?.managementFeeMemory&&!r.managementFeeMemory.blockers.length],['Resolver pendências dos honorários',noIssue(['Honorários'])]]),
 stage('parameters','Parâmetros de cálculo',[['Parâmetros aprovados no período',!!r&&r.counts.approvedParameters>0],['Vigências completas e sem sobreposição',!!r?.catalog.length&&r.catalog.every(c=>!c.gaps.length&&!c.overlap)],['Resolver tarifas, tributos e bases',noIssue(['Parâmetros','Tributos','Bases tributárias','Bases operacionais'])]]),
 stage('monthly','Dados mensais',[['Registrar medições',!!r?.measurements&&(r.measurements.draftCount+r.measurements.validatedCount)>0],['Validar versão das medições',r?.measurements?.status==='VALIDATED'],['Resolver pendências das medições',noIssue(['Medições'])]]),
 stage('costs','Custos mensais',[['Revisar custos da competência',!!r?.costs&&(r.costs.draftCount+r.costs.validatedCount)>0],['Validar custos ou ausência justificada',!!r&&['VALIDATED','NO_COSTS_DECLARED'].includes(r.costs?.status||'')],['Resolver pendências dos custos',noIssue(['Custos mensais','Custos adicionais'])]])];
 const complete=stages.every(s=>s.percent===100);
 const ready=complete&&!!r&&r.counts.blockers===0&&r.financial?.status==='AVAILABLE'&&r.operationalComposition?.scenarios.length===2&&r.operationalComposition.scenarios.every(s=>s.status==='AVAILABLE');
 const percentage=Math.floor(stages.reduce((sum,s)=>sum+s.percent,0)/stages.length);
 return{stages,ready,percent:ready?100:Math.min(99,percentage)};
}
