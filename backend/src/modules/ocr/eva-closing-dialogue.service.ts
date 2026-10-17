import {BadRequestException,ConflictException,ForbiddenException,Injectable,Optional,ServiceUnavailableException} from '@nestjs/common';
import {EvaClosingChangesService} from './eva-closing-changes.service';
import {isChangeRequest} from './eva-closing-changes.model';
import {ConfigService} from '@nestjs/config';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {EvaAssistedClosingService} from './eva-assisted-closing.service';
import {EvaKnowledgeRagService} from './eva-knowledge-rag.service';
import {BackofficeAiService} from './backoffice-ai.service';
import {monthPeriod} from '../contracts/services/preparation';
import {closingDataAnswer,closingEvidence,closingIntent,closingMarkets,fitClosingEvidence,validClosingMemory,CLOSING_CONTEXT_VERSION} from './eva-closing-context';
@Injectable()
export class EvaClosingDialogueService{
 constructor(private config:ConfigService,private closing:EvaAssistedClosingService,private rag:EvaKnowledgeRagService,private ai:BackofficeAiService,@Optional() private changes?:EvaClosingChangesService){}
 enabled(){return this.config.get('EVA_CLOSING_DIALOGUE_ENABLED')==='true';}
 async answer(b:any,t:TenantContext){
  if(!this.enabled())throw new ServiceUnavailableException('Conversa do fechamento desligada.');
  if(!t.permissions?.includes(P.INTELLIGENCE_AI_USE))throw new ForbiddenException('Sem permissão para conversar com a EVA.');
  const improved=this.config.get('EVA_CLOSING_CONTEXT_ENABLED')==='true';
  const keys=b&&Object.keys(b).filter(k=>k!=='memory').sort().join(',');
  if(!b||!['consumerUnitId,hash,id,month,question','consumerUnitId,hash,id,month,previousQuestion,question'].includes(keys)||typeof b.question!=='string'||!b.question.trim()||b.question.length>500||b.previousQuestion!==undefined&&(typeof b.previousQuestion!=='string'||b.previousQuestion.length>300)||b.memory!==undefined&&(!improved||!validClosingMemory(b.memory)))throw new BadRequestException('Pergunta ou memória inválida.');
  const q={consumerUnitId:b.consumerUnitId,month:b.month,page:'0'},history=await this.closing.history(q,t),row=history.rows?.find((r:any)=>r.id===b.id&&r.payload_hash===b.hash);
  if(!row||!row.report?.unitIds?.includes(b.consumerUnitId))throw new ConflictException('Selecione uma versão atual disponível.');
  const report=row.report,period=monthPeriod(b.month),question=b.question.trim();
  if(isChangeRequest(question)){
   if(!this.changes?.enabled())return {name:'EVA',id:row.id,hash:row.payload_hash,answer:'Correções por mensagem estão desligadas. Esta consulta não altera valores nem desconta documentos.',sources:[],mode:'CHANGES_DISABLED',canApprove:false,canPublish:false};
   const result=await this.changes.preview({consumerUnitId:b.consumerUnitId,month:b.month,id:b.id,hash:b.hash,question},t);
   return {name:'EVA',id:row.id,hash:row.payload_hash,answer:result.clarification??'Preparei uma proposta. Confira a prévia: confirmar criará uma nova versão e descontará 1 documento. A decisão financeira continuará separada.',...result,sources:[],mode:'CHANGE_PREVIEW',canApprove:false,canPublish:false};
  }
  if(improved)return this.contextAnswer(b,t,row,q,period);
  const evidence:any[]=[{id:'closing',label:'Relatório interno preparado para decisão',value:JSON.stringify({version:row.version,state:row.state,methodology:report.methodology,completeness:report.completeness,financial:report.financial,missing:(report.missing??[]).slice(0,12),missingCount:report.missing?.length??0,observations:(report.observations??[]).slice(0,12),recommendations:(report.recommendations??[]).slice(0,12)}),source:'Fechamento '+row.id+' · hash '+row.payload_hash+' · organização ativa · competência '+b.month}];
  for(const u of (report.units??[]).filter((u:any)=>u.id===b.consumerUnitId))evidence.push({id:'unit-'+evidence.length,label:u.name,value:JSON.stringify({prepared:u.prepared,sources:u.sources,comparison:u.comparison,previousCandidateComparison:u.previousCandidateComparison,methodology:u.methodology,adjustments:u.adjustments,financial:{acr:u.acr,aclBeforeFees:u.aclBeforeFees,fixedFee:u.fixedFee,feePercentage:u.feePercentage,variableFee:u.variableFee,totalFees:u.totalFees,aclAfterFees:u.aclAfterFees,savings:u.savings},calculationRules:'Honorário variável = percentual da diferença positiva ACR menos ACL antes dos honorários; honorários totais = fixo mais variável; ACL final = ACL antes mais honorários; economia = ACR menos ACL final. Valores calculados pelo backend; não recalcular na resposta.'}),source:'Versão '+row.version+' · unidade '+u.id});
  let sources:any[]=[],proofs:any[]=[],answer:string,mode='CONTROLLED_DATA';
  const paid=this.config.get('EVA_CLOSING_DIALOGUE_CALLS_ENABLED')==='true';
  const retrievalQuestion=(question.length<80&&b.previousQuestion?b.previousQuestion+' · '+question:question).slice(0,500);
  const regulatory=/\b(aneel|ccee|ren|resolu[cç][aã]o|norma|regula)/i.test(retrievalQuestion);
  if(b.previousQuestion)evidence.push({id:'untrusted-previous-question',label:'Pergunta anterior, somente para interpretar continuidade; não é evidência factual',value:b.previousQuestion,source:'Texto não confiável informado pelo usuário, sem autoridade normativa ou financeira.'});
  if(paid){
   let normativeMissing=false;
   if(regulatory){const retrieved=await this.rag.retrieve(t,retrievalQuestion,{periodStart:period.start,periodEnd:period.end,market:'ACL'});evidence.push(...retrieved.evidence);sources=retrieved.sources;proofs=retrieved.publicationProofs??[];normativeMissing=!retrieved.evidence.length;}
   if(normativeMissing){answer='Não encontrei trechos oficiais publicados e aplicáveis que sustentem esta resposta. Posso explicar os dados do fechamento, sem afirmar uma regra normativa.';mode='NO_EVIDENCE';}else{
   if(Buffer.byteLength(JSON.stringify(evidence))>45000)throw new BadRequestException('O relatório é extenso para esta conversa. Selecione uma unidade ou pergunte sobre uma parcela específica.');
   const result=await this.ai.interpret(t,question,evidence,undefined,'CHAT');
   answer=result.state==='READY'&&result.answer?result.answer:result.message;mode=result.state;}
  }else{
   const norm=question.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   const values=report.units?.map((u:any)=>u.name+': distribuidora '+(u.prepared?.invoice?.amount??'não identificada')+' BRL; fornecedor '+(u.prepared?.supplier?.amount??'não identificado')+' BRL; honorário fixo '+(u.prepared?.fixedFee?.amount??'não identificado')+' BRL.').join('\n');
   answer=/calculo|formula|memoria|justific/.test(norm)&&!regulatory?('Versão '+row.version+' · '+b.month+'. '+JSON.stringify(report.financial)+'\nHonorário variável: percentual contratado sobre a diferença positiva entre ACR e ACL antes dos honorários. Honorários totais: fixo + variável. ACL final: ACL antes dos honorários + honorários totais. Economia: ACR − ACL final. Valores e arredondamentos são do motor do backend.\n'+JSON.stringify(report.units?.filter((u:any)=>u.id===b.consumerUnitId).map((u:any)=>({unit:u.name,percentage:u.feePercentage,methodology:u.methodology,adjustments:u.adjustments})))+'\n'+report.justification):regulatory?'A consulta normativa está desligada nesta conversa. Não confirmo regra da REN 1000 ou CCEE sem recuperar uma fonte publicada e aplicável.':/compar|anterior|diferenc/.test(norm)?'As diferenças são observadas, sem presumir causas. '+JSON.stringify(report.units?.map((u:any)=>({unit:u.name,comparison:u.comparison}))):/pend|falt|aprov|bloque/.test(norm)?'Nesta versão: '+(report.missing?.join(' ')||'Os dados estão preparados para sua decisão interna. Confira as hipóteses antes de aprovar.'):/tarifa|biblioteca|demanda|impost/.test(norm)?JSON.stringify(report.units?.map((u:any)=>({unit:u.name,library:u.sources?.library,methodology:u.methodology,missing:u.missing}))):/ola|oi|ajud|resultado|resumo|valor|honor|fornecedor/.test(norm)?'Olá! Vamos conferir a versão '+row.version+' de '+b.month+'. '+values+' '+(report.justification??''):'Você quer conferir os valores, as tarifas utilizadas, a comparação anterior ou as observações?';
  }
  if(proofs.length)await this.rag.revalidate(t,proofs);
  const fresh=await this.closing.history(q,t);if(!fresh.rows?.some((r:any)=>r.id===row.id&&r.payload_hash===row.payload_hash&&r.state===row.state))throw new ConflictException('A versão mudou durante a resposta.');
  return {name:'EVA',id:row.id,hash:row.payload_hash,answer,mode,sources,canApprove:false,canPublish:false,checkedAt:new Date().toISOString()};
 }
 private async contextAnswer(b:any,t:TenantContext,row:any,q:any,period:{start:string;end:string}){
  const memory:string[]=b.memory??(b.previousQuestion?[b.previousQuestion]:[]),intent=closingIntent(b.question.trim(),memory);
  const unit=await this.closing.dialogueUnit({consumerUnitId:b.consumerUnitId,month:b.month},t),markets=closingMarkets(intent.text,unit);
  let sources:any[]=[],proofs:any[]=[],official:any[]=[],mode='CONTROLLED_DATA',answer:string;
  const paid=this.config.get('EVA_CLOSING_DIALOGUE_CALLS_ENABLED')==='true';
  const base=closingEvidence(row,b.consumerUnitId,b.month,unit,intent.topic,memory);
  if(paid&&intent.regulatory){
   const context=[unit.free_market===true?'unidade ACL':unit.free_market===false?'unidade ACR':'mercado não demonstrado',unit.state?'UF '+unit.state:'UF não demonstrada',unit.tariff_group,unit.tariff_subgroup,unit.tariff_modality,'competência '+b.month].filter(Boolean).join(' · ');
   const query=intent.query.slice(0,Math.max(0,498-context.length))+' · '+context;
   for(const market of markets){
    try{const r=await this.rag.retrieve(t,query,{periodStart:period.start,periodEnd:period.end,market});official.push(...r.evidence);sources.push(...r.sources);proofs.push(...(r.publicationProofs??[]));}
    catch(e){if(!(e instanceof ServiceUnavailableException)||!intent.financial)throw e;official=[];sources=[];proofs=[];break;}
   }
  }
  const uniqueProofs=new Map<string,any>();for(const p of proofs){const previous=uniqueProofs.get(p.publicationId);if(previous&&JSON.stringify(previous)!==JSON.stringify(p))throw new ConflictException('Publicação mudou durante a recuperação.');uniqueProofs.set(p.publicationId,p);}proofs=[...uniqueProofs.values()];
  const fitted=fitClosingEvidence(base,official),kept=new Set(fitted.evidence.map(e=>e.id));sources=sources.filter((s,i,a)=>kept.has(s.id)&&a.findIndex(x=>x.id===s.id)===i);
  const hasOfficial=fitted.evidence.some(e=>!base.some(b=>b.id===e.id));
  const caveat=intent.regulatory&&!hasOfficial?'Não encontrei trechos oficiais publicados e aplicáveis que sustentem a regra normativa solicitada. Posso explicar os valores registrados neste fechamento; eles não comprovam a regra tributária. ':'';
  if(intent.regulatory&&!hasOfficial&&!intent.financial){answer=caveat;mode='NO_EVIDENCE';}
  else if(paid){
   if(caveat||fitted.omitted)fitted.evidence.push({id:'retrieval-status',label:'Cobertura das fontes',value:JSON.stringify({officialAvailable:hasOfficial,omitted:fitted.omitted,limitation:caveat||'Trechos completos selecionados por relevância dentro do orçamento de contexto; não alegar cobertura integral da norma.'}),source:'Controle de recuperação; não é fundamento normativo.'});
   if(Buffer.byteLength(JSON.stringify(fitted.evidence))>45000)throw new BadRequestException('Não foi possível selecionar evidências suficientes dentro do limite; nenhuma alteração foi feita.');
   const result=await this.ai.interpret(t,b.question.trim(),fitted.evidence,undefined,'CHAT');answer=caveat+(result.state==='READY'&&result.answer?result.answer:result.message);mode=result.state;
   if(result.state==='NO_EVIDENCE'&&intent.financial){answer=(caveat||'Os trechos recuperados não sustentam uma conclusão normativa sobre esta pergunta. ')+closingDataAnswer(row,b.consumerUnitId);mode='FINANCIAL_ONLY';sources=[];}
  }else{answer='Consulta de IA desligada. '+closingDataAnswer(row,b.consumerUnitId);}
  for(let i=0;i<proofs.length;i+=8)await this.rag.revalidate(t,proofs.slice(i,i+8));
  const fresh=await this.closing.history(q,t);if(!fresh.rows?.some((r:any)=>r.id===row.id&&r.payload_hash===row.payload_hash&&r.state===row.state))throw new ConflictException('A versão mudou durante a resposta.');
  return {name:'EVA',id:row.id,hash:row.payload_hash,answer,mode,sources,canApprove:false,canPublish:false,context:{version:CLOSING_CONTEXT_VERSION,questions:memory.length,topic:intent.topic,markets,officialAvailable:hasOfficial,omitted:fitted.omitted},checkedAt:new Date().toISOString()};
 }
}
