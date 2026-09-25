import 'reflect-metadata';
import {plainToInstance} from 'class-transformer';
import {validateSync} from 'class-validator';
import {MonthlyCostsPayloadDto} from '../dto/monthly-costs.dto';
import {costIssues} from './monthly-costs';
import type {Finding} from './preparation';
export function prepareCosts(unit:any,month:string,rows:any[]){
 const findings:Finding[]=[];
 const add=(code:string,message:string,severity:Finding['severity']='BLOCKER')=>findings.push({code,section:'Custos mensais',severity,message});
 const scoped=rows.filter(r=>r.organization_id===unit.organization_id&&r.customer_id===unit.customer_id&&r.consumer_unit_id===unit.id&&r.month===month).sort((a,b)=>b.version-a.version);
 const drafts=scoped.filter(r=>r.status==='DRAFT'),validated=scoped.filter(r=>r.status==='VALIDATED'),latest=validated[0];
 const summary={status:!scoped.length?'MISSING':drafts.length?'DRAFT_PENDING':latest?'VALIDATED':'INVALID',draftCount:drafts.length,validatedCount:validated.length,validatedVersion:null as null|{id:string;version:number;revision:number;validatedAt:string;source:string;costs:MonthlyCostsPayloadDto}};
 if(!scoped.length)add('COSTS_MISSING','Cadastre e valide os custos/créditos da competência ou declare a ausência após revisão em Custos mensais.');
 if(drafts.length)add('COSTS_DRAFT',latest?'Existe uma correção de custos em rascunho. Revise e valide a nova versão antes da apuração.':'Os custos estão em rascunho. Solicite validação por Gestor ou Administrador.');
 const versions=scoped.map(r=>r.version);
 if(scoped.some(r=>!['DRAFT','VALIDATED'].includes(r.status)||!Number.isInteger(r.version)||r.version<1)||new Set(versions).size!==versions.length||drafts.length>1||drafts.some(r=>latest&&r.version<=latest.version))add('COSTS_HISTORY','O histórico dos custos apresenta inconsistência. Solicite revisão administrativa.');
 if(!latest){if(scoped.length&&!drafts.length)add('COSTS_UNVALIDATED','Não há versão validada dos custos.');return {...summary,findings};}
 const raw=latest.costs;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)){add('COSTS_INVALID','Estrutura de custos inválida. Solicite revisão.');return {...summary,status:'INVALID',findings};}
 const costs=plainToInstance(MonthlyCostsPayloadDto,raw);
 if(validateSync(costs,{whitelist:true,forbidNonWhitelisted:true,forbidUnknownValues:true}).length){add('COSTS_INVALID','A versão validada possui valores ou classificações inválidos. Registre uma versão corrigida.');return {...summary,status:'INVALID',findings};}
 summary.validatedVersion={id:latest.id,version:latest.version,revision:latest.revision,validatedAt:latest.validated_at,source:latest.source_reference,costs};
 for(const message of costIssues(costs,true))add('COSTS_INCONSISTENT',message);
 if(!latest.validated_at||!latest.validated_by||typeof latest.source_reference!=='string'||!latest.source_reference.trim())add('COSTS_EVIDENCE','A versão não possui validação ou fonte identificada. Solicite revisão.');
 if(!latest.unit_context||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','free_market'].some(k=>(latest.unit_context[k]??null)!==(unit[k]??null)))add('COSTS_CONTEXT','O cadastro elétrico mudou desde o registro dos custos. Confira-o e valide uma nova versão.');
 if(costs.items.length)add('COSTS_RECONCILIATION','Concilie os lançamentos com os contratos, tarifas e faturas para evitar duplicidade; confira o rateio atribuído à unidade.','REVIEW');
 if(costs.items.some(i=>i.taxTreatment==='EXCLUDED'))add('COSTS_TAX_EXCLUDED','Há valores sem tributos incluídos. As bases e os tributos correspondentes ainda precisam ser tratados no motor; este diagnóstico não calcula gross-up.','REVIEW');
 if(!drafts.length&&costs.noCosts&&!findings.some(f=>f.severity==='BLOCKER'))summary.status='NO_COSTS_DECLARED';
 return {...summary,findings};
}
