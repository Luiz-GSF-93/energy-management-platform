import {Injectable} from '@nestjs/common';
import {customerTemplateName,hasNoRuntimeParameters} from './whatsapp-template-selection';

export const customerTemplates = [
 {name:'energyos_alerta_custos',label:'Alerta de custos'},
 {name:'energyos_relatorio_disponivel',label:'Relatório disponível'},
 {name:'energyos_solicitacao_cliente',label:'Solicitação ao cliente'},
 {name:'energyos_lembrete_prazo',label:'Lembrete de prazo'},
 {name:'energyos_adesao_atualizada',label:'Atualização da Adesão ACL'},
] as const;
type TemplateState='APPROVED'|'PENDING'|'REJECTED'|'PAUSED'|'DISABLED'|'IN_APPEAL'|'PENDING_DELETION'|'DELETED'|'UNKNOWN'|'MISSING'|'UNAVAILABLE';
export type TemplateSnapshot={configured:boolean;checkedAt:string;manageUrl:string|null;rows:{name:string;label:string;status:TemplateState;parameterless?:boolean}[]};
const states=new Set<TemplateState>(['APPROVED','PENDING','REJECTED','PAUSED','DISABLED','IN_APPEAL','PENDING_DELETION','DELETED']);

/** Only approval metadata is returned; credentials, bodies and provider errors stay private. */
export async function inspectCustomerTemplates(env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch):Promise<TemplateSnapshot>{
 const account=env.WHATSAPP_BUSINESS_ACCOUNT_ID,version=env.WHATSAPP_GRAPH_VERSION;
 const configured=!!env.WHATSAPP_ACCESS_TOKEN&&/^\d+$/.test(account??'')&&/^v\d+\.\d+$/.test(version??'');
 const rows=await Promise.all(customerTemplates.map(async original=>{
  const template={...original,name:customerTemplateName(original.name,env)};
  let status:TemplateState='UNAVAILABLE',parameterless=false;
  if(configured)try{
   const query=new URLSearchParams({name:template.name,fields:'name,language,status,components',limit:'100'});
   const response=await transport(`https://graph.facebook.com/${version}/${account}/message_templates?${query}`,{headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.ok){
    const body=await response.json() as {data?:unknown;paging?:{next?:unknown}};
    if(Array.isArray(body.data)){
     const exact=body.data.filter(row=>row?.name===template.name&&row?.language==='pt_BR');
     // Ambiguous or truncated responses never imply approval.
     if(exact.length===1&&!body.paging?.next){status=states.has(exact[0].status)?exact[0].status:'UNKNOWN';parameterless=hasNoRuntimeParameters(exact[0].components);}
     else if(!exact.length&&!body.paging?.next)status='MISSING';
     else status='UNKNOWN';
    }
   }
  }catch{/* Safe status only; no access token or provider response is logged. */}
  return {...template,status,parameterless};
 }));
 return {configured,checkedAt:new Date().toISOString(),manageUrl:/^\d+$/.test(account??'')?`https://business.facebook.com/latest/whatsapp_manager/message_templates/?asset_id=${account}`:null,rows};
}

@Injectable()
export class WhatsappTemplatesService{
 private cached?:{expires:number;value:TemplateSnapshot};
 private loading?:Promise<TemplateSnapshot>;
 async inspect(){
  if(this.cached&&this.cached.expires>Date.now())return this.cached.value;
  if(this.loading)return this.loading;
  this.loading=inspectCustomerTemplates().then(value=>{this.cached={expires:Date.now()+60000,value};return value;}).finally(()=>{this.loading=undefined;});
  return this.loading;
 }
}
