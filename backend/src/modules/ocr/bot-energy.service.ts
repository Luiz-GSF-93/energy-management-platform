import {BotEnergyContextService} from './bot-energy-context.service';
import {BotEnergyRagService} from './bot-energy-rag.service';
import {BadRequestException, ForbiddenException, Injectable,Optional} from '@nestjs/common';
import {AiEvidence} from './azure-backoffice-ai.connector';
import {BackofficeAiService,assistantAiEvidence} from './backoffice-ai.service';
import {OcrAssistantProgressService} from './ocr-assistant-progress.service';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrAssistantService} from './ocr-assistant.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {retrieveTopics,regulatoryReferences} from './bot-energy-retrieval';
import {OcrResolutionService} from './ocr-resolution.service';
import {completionAnswer,CompletionAction} from './bot-energy-completion';

export const botEnergyTopics = [
 {key:'regulation',question:'Como conferir as regras regulatórias da fatura?',answer:'Confira distribuidora, enquadramento e vigência na tabela oficial correspondente. As tarifas de energia e demanda têm unidades diferentes. PIS e Cofins variam por mês; use a alíquota identificada na fatura e confirme a base de incidência. As referências oficiais abaixo apoiam a revisão, mas não comprovam por si só a correção desta fatura ou contrato.',reference:'Base regulatória controlada v1 · fontes oficiais consultadas em 03/10/2026'},
 {key:'workflow',question:'Quem valida e quem aprova?',answer:'O operador confere os campos e as fontes e valida os preenchimentos. O bot-energy prepara somente os rascunhos permitidos. A aprovação financeira é exclusiva do gestor/administrador autorizado; a publicação segue o fluxo financeiro existente.',reference:'ocr-assistant.service.ts · validate; financial-settlements.service.ts · canManage'},
 {key:'confidence',question:'100% significa apuração publicada?',answer:'O progresso de configuração conta verificações atendidas para preparar apuração. 100% não comprova aprovação nem publicação. A confiança OCR mede a leitura e não aumenta por confirmação humana; campo ausente não é zero.',reference:'contract-readiness.ts · verificações; homologation-progress.ts; invoice-readout.ts'},
 {key:'fees',question:'Como são conferidos os honorários híbridos?',answer:'O fixo é integral por unidade. A regra mensal confirma o rateio somente da parcela variável. A memória isolada da unidade aguarda a consolidação do cliente para calcular o variável; isso não exige recadastrar uma regra já confirmada. O progresso só reconhece essa etapa quando a prévia financeira do backend está disponível com o mesmo contrato, versão da regra, mês e unidade, sem bloqueios.',reference:'management-fee-memory.ts; customer-financial-preview.ts; contract-readiness.ts'},
 {key:'taxes',question:'Como evitar cobrar tributos novamente?',answer:'Tributos já incluídos na tarifa bruta não são somados novamente. Informação tributária ausente exige revisão; não significa isenção nem alíquota zero. Toda correção deve preservar a fonte, o autor, o motivo e a versão.',reference:'ocr-tusd-integration.service.ts; ocr-cde-tax-integration.service.ts; ocr-demand-tax-integration.service.ts'},
 {key:'access',question:'Quais dados o bot-energy pode consultar?',answer:'Esta assistência consulta somente regras implementadas e o contexto autorizado da fatura selecionada, com licença, organização e permissões verificadas no backend. Não aprova valores, não executa instruções de arquivos e não consulta dados de outra organização. O atendimento ao cliente ainda não está habilitado.',reference:'TenantGuard; ocr-assistant.service.ts · allowed; bot-energy.service.ts · authorize'},
] as const;
const contextualTopics = [
 {key:'status',question:'Qual o status do preenchimento?'},
 {key:'pending',question:'O que falta nesta fatura?'},
 {key:'fields',question:'Quais campos ainda precisam de validação?'},
 {key:'records',question:'Quais registros e vigências foram encontrados?'},
] as const;
type Item = {label:string;value:string;source:string};
type SupportAnswer={name:string;mode:string;checkedAt:string;canApprove:boolean;canPublish:boolean;status:string;answer:string;items:Item[];sources:{label:string;reference:string;url:string}[];version?:number;retrievedTopics?:string[];actions?:CompletionAction[];interpretationState?:string;contextDocumentId?:string};
@Injectable()
export class BotEnergyService {
 constructor(private readonly assistant:OcrAssistantService,private readonly resolution:OcrResolutionService,@Optional() private readonly ai?:BackofficeAiService,@Optional() private readonly progress?:OcrAssistantProgressService,@Optional() private readonly rag?:BotEnergyRagService,@Optional() private readonly contexts?:BotEnergyContextService){}
 private async authorize(t:TenantContext){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation')throw new ForbiddenException('O bot-energy está disponível somente no backoffice autorizado.');
  await this.assistant.authorize(t);
 }
 async context(t:TenantContext){await this.authorize(t);if(!this.contexts)throw new BadRequestException('Seleção de contexto indisponível.');return this.contexts.list(t);}
 async topics(t:TenantContext){
  await this.authorize(t);
  return {name:'bot-energy',mode:'EXTRACTIVE_RETRIEVAL',version:2,canAsk:t.permissions.includes(P.INTELLIGENCE_AI_USE),canGenerate:!!this.ai&&await this.ai.available(t),topics:[...botEnergyTopics.map(({key,question})=>({key,question})),...contextualTopics],message:'Consulta à base controlada e ao contexto autorizado da fatura. Respostas extrativas com fontes; sem aprovação financeira nem atendimento ao cliente.'};
 }
 async answer(t:TenantContext,body:unknown,document?:string):Promise<SupportAnswer>{
  await this.authorize(t);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Informe uma pergunta.');
  const b=body as Record<string,unknown>,keys=Object.keys(b);
  if(keys.length!==1||!['topic','question'].includes(keys[0])||typeof b[keys[0]]!=='string'||!(b[keys[0]] as string).trim()||(b[keys[0]] as string).length>500)throw new BadRequestException('Informe apenas a pergunta ou o tópico.');
  const normalized=(v:string)=>v.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[?!.]+$/,'');
  const topics=[...botEnergyTopics,...contextualTopics];
  const topic=topics.find(v=>b.topic===v.key||typeof b.question==='string'&&normalized(b.question)===normalized(v.question));
  const base={name:'bot-energy',mode:'CONTROLLED_SUPPORT',checkedAt:new Date().toISOString(),canApprove:false,canPublish:false};
  const inputQuestion=typeof b.question==='string'?b.question:'';
  const denied=/ignore|ignorar|publique|senha|chave privada|token|outra organizacao|execute|executar|apague|deletar/.test(normalized(inputQuestion));
  if(denied)return {...base,status:'NO_EVIDENCE',answer:'Posso explicar regras e registros autorizados do backoffice. Não executo comandos nem altero permissões, validações ou aprovações por uma conversa.',items:[],sources:[]};
  if(topic?.key==='status'||/\b(status|andamento|processando|preenchendo|terminou)\b/.test(normalized(inputQuestion))){
   if(!topic&&!t.permissions.includes(P.INTELLIGENCE_AI_USE))throw new ForbiddenException('Perguntas livres exigem a permissão de uso da IA.');
   if(!document)return {...base,status:'CONTEXT_REQUIRED',answer:'Abra a fatura em Auditoria OCR para consultar o status da preparação nesta sessão.',items:[],sources:[]};
   if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(document))throw new BadRequestException('Fatura inválida.');
   const current=await this.progress?.current(document,t);
   return {...base,mode:'LIVE_STATUS',status:'SUPPORTED',answer:current?.message||(current?.state==='RUNNING'?'A preparação está em andamento.':current?.state==='READY'?'A preparação foi concluída. Confira as fontes e valide os preenchimentos; aprovação financeira é uma etapa separada.':'Não há preparação ativa registrada nesta sessão. Abra a auditoria da fatura.'),items:current?[{label:'Estado da preparação nesta sessão',value:current.state,source:'Execução atual do backend'},{label:'Etapas concluídas',value:current.completed.join(', ')||'Nenhuma etapa concluída ainda',source:'Execução atual do backend'}]:[],sources:[]};
  }
  if(!topic&&inputQuestion&&!t.permissions.includes(P.INTELLIGENCE_AI_USE))throw new ForbiddenException('Perguntas livres exigem a permissão de uso da IA.');
  if(!document&&!topic&&inputQuestion&&this.contexts&&[P.ORGANIZATION_CUSTOMERS_VIEW,P.ORGANIZATION_CONSUMER_UNITS_VIEW].every(p=>t.permissions.includes(p))){
   const selected=await this.contexts.select(t,inputQuestion);
   if(selected.document)document=selected.document.id;
   else if(selected.customerId)return {...base,status:'CONTEXT_REQUIRED',answer:'Encontrei o cliente na organização ativa. Selecione abaixo a unidade, competência e fatura para consultar os valores com suas fontes; não vou escolher entre arquivos ou unidades divergentes.',items:[],sources:[{label:'Escolher fatura do cliente',reference:'Contexto documental autorizado',url:'/backoffice/ocr-audit'}]};
  }
  if(!topic&&inputQuestion&&this.ai&&await this.ai.available(t)){
   if(!t.permissions.includes(P.INTELLIGENCE_AI_USE))throw new ForbiddenException('Perguntas livres exigem a permissão de uso da IA.');
   const evidence:AiEvidence[]=botEnergyTopics.map((r,i)=>({id:'rule-'+i,label:r.question,value:r.answer,source:r.reference}));
   if(!document&&this.contexts&&/\b(cliente|clientes|economia|desperdicio|custo|custos|tarifa|tarifas)\b/.test(normalized(inputQuestion)))evidence.push(...await this.contexts.portfolio(t,inputQuestion));
   let actions:CompletionAction[]=[];let regulatoryState='NO_EVIDENCE';let regulatorySources:{id:string;label:string;reference:string;url:string}[]=[];
   if(document){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(document))throw new BadRequestException('Fatura inválida.');
    const plan=await this.assistant.inspect(document,t);evidence.push(...assistantAiEvidence(plan));
    const completion=completionAnswer(await this.resolution.inspect(document,t));actions=completion.actions;
    evidence.push(...completion.items.map((item,i)=>({id:'completion-'+i,...item})));
   }
   if(this.rag){
    const today=new Date().toISOString().slice(0,10);
    const dateEvidence=evidence.find(e=>e.id==='context')?.value.match(/20\d{2}-(?:0[1-9]|1[0-2])/)?.[0];
    const start=dateEvidence?dateEvidence+'-01':today;
    const end=dateEvidence?new Date(Date.UTC(Number(dateEvidence.slice(0,4)),Number(dateEvidence.slice(5,7)),0)).toISOString().slice(0,10):today;
    const market=/\b(gd|geracao distribuida)\b/.test(normalized(inputQuestion))?'GD':/\b(acl|mercado livre)\b/.test(normalized(inputQuestion))?'ACL':'COMMON';
    const retrieval=await this.rag.retrieve(t,inputQuestion,{periodStart:start,periodEnd:end,market});regulatoryState=retrieval.state;
    if(retrieval.state==='VERSION_CONFLICT')return {...base,status:'NO_EVIDENCE',answer:'Há transição ou conflito de vigência normativa nesta competência. Informe a data do fato para conferir a versão aplicável.',items:[],sources:[]};
    evidence.push(...retrieval.evidence);
    regulatorySources=retrieval.sources.map(s=>({id:s.id,label:s.title+' · '+s.section,reference:'Versão '+s.version+' · vigência '+s.validFrom+' até '+(s.validTo??'sem término cadastrado'),url:s.url}));
    if(retrieval.state!=='READY')evidence.push({id:'library-availability',label:'Disponibilidade da biblioteca oficial',value:'Não há trechos oficiais revisados aplicáveis à consulta. Não afirmar regra de GD nem recomendar tarifa oficial sem evidência; solicitar revisão da biblioteca.',source:'Consulta atual ao catálogo regulatório, estado '+retrieval.state});
   }
   const generated=await this.ai.interpret(t,inputQuestion,evidence,document,'BOT_ENERGY');
   if(generated.state==='READY')return {...base,mode:'AZURE_GENERATIVE',status:'SUPPORTED',contextDocumentId:document,interpretationState:generated.state,answer:generated.answer!+(regulatoryState==='NO_EVIDENCE'?'\n\nBiblioteca oficial: nenhum trecho revisado aplicável disponível; regras regulatórias e preços oficiais ainda exigem revisão da fonte.':''),actions,items:(generated.evidence??[]).map(e=>({label:e.label,value:e.value,source:e.source})),sources:[...regulatorySources.filter(s=>generated.evidence?.some(e=>e.id===s.id)),{label:'Interpretação Azure OpenAI · '+generated.model,reference:generated.promptVersion+' · interpretação para revisão; fontes atuais recuperadas pelo backend',url:document?'/backoffice/ocr-audit':'/backoffice/documents'}]};
   return {...base,mode:'AZURE_GENERATIVE',status:generated.state==='NO_EVIDENCE'?'NO_EVIDENCE':'UNAVAILABLE',interpretationState:generated.state,contextDocumentId:document,answer:generated.message,actions,items:evidence.filter(e=>e.id.startsWith('completion-')||e.id==='context').map(e=>({label:e.label,value:e.value,source:e.source})),sources:document?[{label:'Abrir preenchimentos e fontes desta fatura',reference:'Conferência e validação conforme perfil',url:'/backoffice/contracts?ocrDocument='+encodeURIComponent(document)+'&area=preparation'}]:[]};
  }
  const rules=topic&&botEnergyTopics.find(v=>v.key===topic.key);
  if(rules)return {...base,status:'SUPPORTED',answer:rules.answer,items:[] as Item[],sources:rules.key==='regulation'?regulatoryReferences:[{label:'Regra implementada · versão 1',reference:rules.reference,url:'/backoffice/documents'}]};
  if(!topic&&typeof b.question==='string'){
   const retrieved=retrieveTopics(b.question);
   if(retrieved.length){
    if(!t.permissions.includes(P.INTELLIGENCE_AI_USE))throw new ForbiddenException('Perguntas livres exigem a permissão de uso da IA no perfil backoffice. Nenhuma permissão foi concedida automaticamente.');
    if(document&&retrieved.includes('taxes')&&!retrieved.includes('fields'))retrieved.push('fields');
    const contextual=retrieved.filter(k=>['pending','fields','records'].includes(k));
    const replies=await Promise.all(retrieved.map(key=>this.answer(t,{topic:key},document)));
    const sources=replies.flatMap(r=>r.sources);
    if(retrieved.some(k=>['taxes','records'].includes(k)))sources.push(...regulatoryReferences);
    const unique=sources.filter((s,i)=>sources.findIndex(x=>x.url===s.url&&x.reference===s.reference)===i);
    return {...base,mode:'EXTRACTIVE_RETRIEVAL',version:2,status:contextual.length&&!document?'CONTEXT_REQUIRED':'SUPPORTED',answer:replies.map(r=>r.answer).join('\n\n'),items:replies.flatMap(r=>r.items).slice(0,80),sources:unique,retrievedTopics:retrieved,actions:replies.flatMap(r=>r.actions??[])};
   }
  }
  if(!topic)return {...base,status:'NO_EVIDENCE',answer:'Não encontrei evidência suficiente na base controlada para responder a esta pergunta. Registre uma revisão ou selecione a fatura relacionada. Não vou presumir valores ou regras.',items:[] as Item[],sources:[]};
  if(!document)return {...base,status:'CONTEXT_REQUIRED',answer:'Abra Auditoria OCR, escolha o cliente, a unidade e a fatura e clique em “Abrir auditoria”. Faça a pergunta dentro dessa fatura para consultar o estado atual dos custos e a ação pendente do gestor. A consulta geral não presume qual cliente você deseja.',items:[] as Item[],sources:[]};
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(document))throw new BadRequestException('Fatura inválida.');
  // Existing inspection enforces tenant/document/customer/unit ownership and licences.
  // Deterministic fallback: evidence retrieval never executes a financial write.
  const plan=await this.assistant.inspect(document,t);
  const items:Item[]=[];
  let answer='';
  if(topic.key==='pending'){
   const current=await this.resolution.inspect(document,t);
   const completion=completionAnswer(current);
   return {...base,checkedAt:plan.checkedAt,status:'SUPPORTED',...completion,items:[...completion.items,...plan.fieldTasks.filter(f=>!f.confirmed).map(f=>({label:f.label,value:f.canConfirm?'Confirme o valor extraído na conferência da fatura.':'Solicite revisão: sem evidência suficiente ou com inconsistência.',source:f.source||'Fonte não identificada'}))],sources:[{label:'Plano atual da fatura · '+current.unit+' · '+current.month,reference:'Preenchimentos e decisões com evidências atuais; consulta sem gravação',url:'/backoffice/contracts?ocrDocument='+encodeURIComponent(document)+'&area=preparation'}]};
  }else if(topic.key==='fields'){
   answer='Conferências atuais da evidência selecionada. Confirmações anteriores são preservadas. A confiança OCR não é alterada por estas conferências.';
   items.push(...plan.fieldTasks.map(f=>({label:f.label,value:`${f.value??'Não identificado'} ${f.unit??''} · ${f.confirmed?'Conferência salva':f.canConfirm?'Validação do operador pendente':'Revisão necessária'}`,source:f.source||'Fonte não identificada'})));
   items.push(...(plan.prefilled?.taxes??[]).map(v=>({label:'Alíquota '+v.code,value:v.rate+'% · transcrita do resumo; incidência por rubrica exige conferência.',source:v.source})));
   items.push(...(plan.prefilled?.tariffs??[]).map(v=>({label:v.component+' · '+v.band,value:v.rateMwh===null?'Tarifa sem evidência suficiente; revisar.':v.rateMwh+' R$/MWh · '+v.reason,source:v.source||'Fonte não identificada'})));
  }else{
   answer=`Registros encontrados para ${plan.unitName} · ${plan.month}. Cadastro ou versão mensal validada não comprova settlement aprovado nem publicação.`;
   items.push(...plan.configurations.map(c=>({label:c.label,value:c.state==='AVAILABLE'?'Disponível na competência':'Ação necessária',source:'Diagnóstico atual da competência'})));
   items.push({label:'Dados mensais',value:plan.records.measurements.status,source:'Registro mensal atual'},{label:'Custos mensais',value:plan.records.costs.status,source:'Registro de custos atual'});
   const fees=plan.records.managementFees;
   if(fees)items.push({label:'Honorários da unidade',value:fees.status==='VARIABLE_PENDING'?'Regra mensal confirmada; parcela variável depende da consolidação do cliente.':fees.status==='FIXED_AVAILABLE'?'Fixo por unidade disponível.':'Conferência necessária.',source:fees.allocation?.source||'Memória de honorários da competência'});
   items.push(...plan.records.suppliers.map(s=>({label:'Contrato do fornecedor',value:`${s.number} · ${s.start} a ${s.end}`,source:s.id})));
   items.push(...(plan.prefilled?.relatedDocuments??[]).map(d=>({label:'Arquivo relacionado · '+d.name,value:d.message,source:d.source})));
   items.push(...plan.records.catalog.flatMap(c=>c.versions.map(v=>({label:c.label,value:`Revisão ${v.revision} · ${v.start} a ${v.end}`,source:v.source||v.id}))));
  }
  return {...base,checkedAt:plan.checkedAt,status:'SUPPORTED',answer,items,sources:[{label:`Fatura ${document} · ${plan.unitName} · ${plan.month}`,reference:'Inspeção atual do assistente e histórico auditado',url:'/backoffice/contracts?ocrDocument='+encodeURIComponent(document)+'&area=preparation'}]};
 }
}
