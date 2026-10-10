import {BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {createHash} from 'node:crypto';
import {SalesCommercialService,commercialInput} from './sales-commercial.service';
import {offerDocumentModel} from './sales-offer-document';
import {ProposalDocumentModel} from './sales-proposal-document';
import {renderContractDraftPdf} from './sales-contract-drafts.pdf';

export function contractTextChunks(text:string):string[]{
 const chunks:string[]=[];
 while(text.length>700){const space=text.lastIndexOf(' ',699),cut=space>100?space+1:700;chunks.push(text.slice(0,cut));text=text.slice(cut);}
 if(text)chunks.push(text);return chunks;
}

export function contractDraftModel(snapshot:any,id:string):ProposalDocumentModel {
 if(!snapshot?.template?.definition||!snapshot?.parties||snapshot.rendererVersion!=='contract-draft-v1')throw new ServiceUnavailableException('Minuta indisponível.');
 const model=offerDocumentModel({proposal:snapshot.proposal,terms:snapshot.terms,asOfDate:snapshot.asOfDate,expired:false});
 const party=(name:string,value:any)=>({title:name,rows:Object.entries({name:'Razão social',document:'Documento',address:'Endereço',signatory:'Signatário indicado',email:'E-mail do signatário'}).map(([key,label])=>({label,value:String(value[key])}))});
 return {...model,id,title:'Minuta contratual interna',notice:'MINUTA INTERNA - sem assinatura, cobrança ou ativação.',sections:[
  {title:'Modelo preservado',rows:[{label:'Título',value:snapshot.template.definition.title},{label:'Modelo / revisão',value:`${snapshot.template.id} / ${snapshot.template.revision}`},{label:'Minuta',value:id}]},
  party('Prestadora',snapshot.parties.supplier),party('Contratante',snapshot.parties.customer),...model.sections,
  ...snapshot.template.definition.clauses.map((clause:any,index:number)=>({title:`${index+1}. ${clause.title}`,rows:contractTextChunks(clause.text).map((value:string,part:number)=>({label:part?'Continuação':'Cláusula para conferência',value}))}))
 ]};
}

@Injectable()
export class SalesContractDraftsService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private enabled(){if(this.config.get('SALES_CONTRACT_DRAFTS_ENABLED')!=='true')throw new ServiceUnavailableException('Minutas contratuais aguardam habilitação e homologação.');}
 private call(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_contract_action',{p_actor:actor,p_action:action,p_body:body});}
 list(actor:string,q:Record<string,unknown>){
  if(Object.keys(q).some(k=>!['page','search','status'].includes(k))||q.page!==undefined&&!/^\d{1,4}$/.test(String(q.page))||q.search!==undefined&&typeof q.search!=='string'||q.status!==undefined&&typeof q.status!=='string')throw new BadRequestException('Filtros inválidos.');
  return this.call(actor,'list',{page:Number(q.page??0),search:q.search??'',status:q.status??''});
 }
 read(actor:string,id:string){commercialInput({id},['id'],['id']);return this.call(actor,'read',{id});}
 saveTemplate(actor:string,body:unknown){
  const b=commercialInput(body,['id','requestId','expectedRevision','definition','justification'],['id','requestId'],['expectedRevision']);
  return this.call(actor,'template',b);
 }
 review(actor:string,body:unknown){
  const b=commercialInput(body,['id','requestId','kind','revision','expectedVersion','status','justification'],['id','requestId'],['revision','expectedVersion']);
  return this.call(actor,'review',b);
 }
 async create(actor:string,body:unknown){
  const b=commercialInput(body,['id','proposalId','termsRevision','templateId','templateRevision','parties','justification'],['id','proposalId','templateId'],['termsRevision','templateRevision']);
  // An uncertain response is recovered by the same ID, never by silently issuing a new one.
  let existing:any;
  try{existing=await this.read(actor,b.id);}catch(error){if(!(error instanceof NotFoundException))throw error;}
  if(existing){
   const sameParty=(x:any,y:any)=>JSON.stringify(Object.entries(x??{}).sort())===JSON.stringify(Object.entries(y??{}).sort());
   if(existing.actor_id!==actor||existing.proposal_id!==b.proposalId||existing.terms_revision!==b.termsRevision||existing.template_id!==b.templateId||existing.template_revision!==b.templateRevision||existing.justification!==b.justification||!sameParty(existing.snapshot.parties?.supplier,b.parties?.supplier)||!sameParty(existing.snapshot.parties?.customer,b.parties?.customer))throw new ConflictException('Identificador já utilizado por outra minuta.');
   return {id:existing.id,sha256:existing.sha256};
  }
  const snapshot=await this.call(actor,'prepare',b);
  const file=await renderContractDraftPdf(contractDraftModel(snapshot,b.id));
  if(file.length>1048576)throw new BadRequestException('Minuta excede o limite do documento interno.');
  return this.call(actor,'store',{...b,requestId:b.id,snapshot,rendererVersion:'contract-draft-v1',hex:file.toString('hex')});
 }
 async pdf(actor:string,id:string){
  commercialInput({id},['id'],['id']);
  const data=await this.call(actor,'pdf',{id});
  if(typeof data?.hex!=='string'||data.hex.length>2097152||!/^[a-f0-9]+$/.test(data.hex)||typeof data.sha256!=='string')throw new ServiceUnavailableException('Documento preservado indisponível.');
  const bytes=Buffer.from(data.hex,'hex');
  if(createHash('sha256').update(bytes).digest('hex')!==data.sha256||bytes.subarray(0,5).toString()!=='%PDF-')throw new ServiceUnavailableException('Integridade do documento não confirmada.');
  return bytes;
 }
}
