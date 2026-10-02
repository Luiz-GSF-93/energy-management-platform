import {BadRequestException, ForbiddenException, Injectable} from '@nestjs/common';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
import {OcrAssistantService} from './ocr-assistant.service';

export const botEnergyTopics = [
 {key:'workflow',question:'Quem valida e quem aprova?',answer:'O operador confere os campos e as fontes e valida os preenchimentos. O bot-energy prepara somente os rascunhos permitidos. A aprovação financeira é exclusiva do gestor/administrador autorizado; a publicação segue o fluxo financeiro existente.',reference:'ocr-assistant.service.ts · validate; financial-settlements.service.ts · canManage'},
 {key:'confidence',question:'100% significa apuração publicada?',answer:'O progresso de configuração conta verificações atendidas para preparar apuração. 100% não comprova aprovação nem publicação. A confiança OCR mede a leitura e não aumenta por confirmação humana; campo ausente não é zero.',reference:'contract-readiness.ts · verificações; homologation-progress.ts; invoice-readout.ts'},
 {key:'fees',question:'Como são conferidos os honorários híbridos?',answer:'O fixo é integral por unidade. A regra mensal confirma o rateio somente da parcela variável. A memória isolada da unidade aguarda a consolidação do cliente para calcular o variável; isso não exige recadastrar uma regra já confirmada. O progresso só reconhece essa etapa quando a prévia financeira do backend está disponível com o mesmo contrato, versão da regra, mês e unidade, sem bloqueios.',reference:'management-fee-memory.ts; customer-financial-preview.ts; contract-readiness.ts'},
 {key:'taxes',question:'Como evitar cobrar tributos novamente?',answer:'Tributos já incluídos na tarifa bruta não são somados novamente. Informação tributária ausente exige revisão; não significa isenção nem alíquota zero. Toda correção deve preservar a fonte, o autor, o motivo e a versão.',reference:'ocr-tusd-integration.service.ts; ocr-cde-tax-integration.service.ts; ocr-demand-tax-integration.service.ts'},
 {key:'access',question:'Quais dados o bot-energy pode consultar?',answer:'Esta assistência consulta somente regras implementadas e o contexto autorizado da fatura selecionada, com licença, organização e permissões verificadas no backend. Não aprova valores, não executa instruções de arquivos e não consulta dados de outra organização. O atendimento ao cliente ainda não está habilitado.',reference:'TenantGuard; ocr-assistant.service.ts · allowed; bot-energy.service.ts · authorize'},
] as const;
const contextualTopics = [
 {key:'pending',question:'O que falta nesta fatura?'},
 {key:'fields',question:'Quais campos ainda precisam de validação?'},
 {key:'records',question:'Quais registros e vigências foram encontrados?'},
] as const;
type Item = {label:string;value:string;source:string};
@Injectable()
export class BotEnergyService {
 constructor(private readonly assistant:OcrAssistantService){}
 private async authorize(t:TenantContext){
  if(!t?.organizationId||!t.userId||(t.scope as string)==='global'||!['operacional','gestor','admin_org'].includes(t.role)&&t.accessMode!=='platform_operation')throw new ForbiddenException('O bot-energy está disponível somente no backoffice autorizado.');
  await this.assistant.authorize(t);
 }
 async topics(t:TenantContext){
  await this.authorize(t);
  return {name:'bot-energy',mode:'CONTROLLED_SUPPORT',version:1,topics:[...botEnergyTopics.map(({key,question})=>({key,question})),...contextualTopics],message:'Perguntas controladas sobre regras e registros. Atendimento livre com RAG e acesso do cliente ainda não habilitados.'};
 }
 async answer(t:TenantContext,body:unknown,document?:string){
  await this.authorize(t);
  if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('Informe uma pergunta.');
  const b=body as Record<string,unknown>,keys=Object.keys(b);
  if(keys.length!==1||!['topic','question'].includes(keys[0])||typeof b[keys[0]]!=='string'||!(b[keys[0]] as string).trim()||(b[keys[0]] as string).length>500)throw new BadRequestException('Informe apenas a pergunta ou o tópico.');
  const normalized=(v:string)=>v.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[?!.]+$/,'');
  const topics=[...botEnergyTopics,...contextualTopics];
  const topic=topics.find(v=>b.topic===v.key||typeof b.question==='string'&&normalized(b.question)===normalized(v.question));
  const base={name:'bot-energy',mode:'CONTROLLED_SUPPORT',checkedAt:new Date().toISOString(),canApprove:false,canPublish:false};
  const rules=topic&&botEnergyTopics.find(v=>v.key===topic.key);
  if(rules)return {...base,status:'SUPPORTED',answer:rules.answer,items:[] as Item[],sources:[{label:'Regra implementada · versão 1',reference:rules.reference,url:'/backoffice/documents'}]};
  if(!topic)return {...base,status:'NO_EVIDENCE',answer:'Não tenho uma resposta comprovada para esta pergunta na assistência controlada. Selecione uma pergunta disponível ou registre um requisito de revisão com o operador/gestor. Não vou presumir informações.',items:[] as Item[],sources:[]};
  if(!document)return {...base,status:'CONTEXT_REQUIRED',answer:'Abra o bot-energy na fatura desejada em Documentos para consultar seus registros e fontes.',items:[] as Item[],sources:[]};
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(document))throw new BadRequestException('Fatura inválida.');
  // Existing inspection enforces tenant/document/customer/unit ownership and licences.
  // Retrieved text is evidence only. No model, tool execution or financial write occurs here.
  const plan=await this.assistant.inspect(document,t);
  const items:Item[]=[];
  let answer='';
  if(topic.key==='pending'){
   answer=`${plan.unitName} · ${plan.month}: ${plan.counts.blockers} bloqueio(s) e ${plan.counts.reviews} revisão(ões) para preparar apuração. Este diagnóstico não comprova aprovação financeira ou publicação.`;
   items.push(...plan.findings.map(f=>({label:`${f.severity==='BLOCKER'?'Bloqueio':'Revisão'} · ${f.section}`,value:f.message,source:f.code})));
   items.push(...plan.fieldTasks.filter(f=>!f.confirmed).map(f=>({label:f.label,value:f.canConfirm?'Conferência do operador pendente.':'Campo bloqueado ou sem evidência suficiente; solicitar revisão.',source:f.source||'Fonte não identificada'})));
  }else if(topic.key==='fields'){
   answer='Conferências atuais da evidência selecionada. Confirmações anteriores são preservadas. A confiança OCR não é alterada por estas conferências.';
   items.push(...plan.fieldTasks.map(f=>({label:f.label,value:`${f.value??'Não identificado'} ${f.unit??''} · ${f.confirmed?'Conferência salva':f.canConfirm?'Validação do operador pendente':'Revisão necessária'}`,source:f.source||'Fonte não identificada'})));
  }else{
   answer=`Registros encontrados para ${plan.unitName} · ${plan.month}. Cadastro ou versão mensal validada não comprova settlement aprovado nem publicação.`;
   items.push(...plan.configurations.map(c=>({label:c.label,value:c.state==='AVAILABLE'?'Disponível na competência':'Ação necessária',source:'Diagnóstico atual da competência'})));
   items.push({label:'Dados mensais',value:plan.records.measurements.status,source:'Registro mensal atual'},{label:'Custos mensais',value:plan.records.costs.status,source:'Registro de custos atual'});
   const fees=plan.records.managementFees;
   if(fees)items.push({label:'Honorários da unidade',value:fees.status==='VARIABLE_PENDING'?'Regra mensal confirmada; parcela variável depende da consolidação do cliente.':fees.status==='FIXED_AVAILABLE'?'Fixo por unidade disponível.':'Conferência necessária.',source:fees.allocation?.source||'Memória de honorários da competência'});
   items.push(...plan.records.suppliers.map(s=>({label:'Contrato do fornecedor',value:`${s.number} · ${s.start} a ${s.end}`,source:s.id})));
   items.push(...plan.records.catalog.flatMap(c=>c.versions.map(v=>({label:c.label,value:`Revisão ${v.revision} · ${v.start} a ${v.end}`,source:v.source||v.id}))));
  }
  return {...base,checkedAt:plan.checkedAt,status:'SUPPORTED',answer,items,sources:[{label:`Fatura ${document} · ${plan.unitName} · ${plan.month}`,reference:'Inspeção atual do assistente e histórico auditado',url:'/backoffice/contracts?ocrDocument='+encodeURIComponent(document)+'&area=preparation'}]};
 }
}
