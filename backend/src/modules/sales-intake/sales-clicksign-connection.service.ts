import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {commercialInput,SalesCommercialService} from './sales-commercial.service';
export const CLICKSIGN_PRODUCTION_CHECK_URL='https://app.clicksign.com/api/v3/envelopes?page[size]=1';
@Injectable()
export class SalesClicksignConnectionService {
 constructor(private readonly commercial:SalesCommercialService,private readonly config:ConfigService){}
 private enabled(){if(this.config.get('SALES_CLICKSIGN_CONNECTION_ENABLED')!=='true')throw new ServiceUnavailableException('Verificação Clicksign produção desligada.');}
 private token(){this.enabled();const token=this.config.get<string>('SALES_CLICKSIGN_PRODUCTION_TOKEN');if(this.config.get('SALES_CLICKSIGN_CONNECTION_CALLS_ENABLED')!=='true'||typeof token!=='string'||token.length<20||token.length>500||/[\s\x00-\x1f\x7f]/.test(token))throw new ServiceUnavailableException('Consulta Clicksign produção desligada.');return token;}
 private rpc(actor:string,action:string,body:unknown){this.enabled();return this.commercial.rpc('platform_sales_clicksign_connection_action',{p_actor:actor,p_action:action,p_body:body});}
 async list(actor:string,q:Record<string,unknown>={}){
  if(Object.keys(q).some(k=>k!=='page'&&k!=='accountId')||typeof q.accountId!=='string'||! /^[1-9]\d{0,11}$/.test(q.accountId)||q.page!==undefined&&(typeof q.page!=='string'||!/^\d{1,4}$/.test(q.page)||Number(q.page)>1000))throw new BadRequestException('Filtro inválido.');
  const data=await this.rpc(actor,'list',{accountId:q.accountId,page:Number(q.page??0)});let callsEnabled=false;try{this.token();callsEnabled=true;}catch{}return {...data,callsEnabled};
 }
 async check(actor:string,body:unknown){
  const b=commercialInput(body,['requestId','accountId','justification'],['requestId']);
  if(typeof b.accountId!=='string'||! /^[1-9]\d{0,11}$/.test(b.accountId)||typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))throw new BadRequestException('Informe conta declarada e justificativa válidas.');
  const token=this.token(),reservation=await this.rpc(actor,'begin',b);if(reservation.replayed)return reservation;
  let state='INCOMPLETE',diagnostic='NETWORK',httpStatus:number|null=null;
  try{
   const response=await fetch(CLICKSIGN_PRODUCTION_CHECK_URL,{method:'GET',headers:{Authorization:token,Accept:'application/vnd.api+json'},redirect:'error',signal:AbortSignal.timeout(10000)});
   httpStatus=response.status;
   if([401,403].includes(response.status)){state='REJECTED';diagnostic='HTTP';await response.body?.cancel();}
   else if(response.status!==200){diagnostic='HTTP';await response.body?.cancel();}
   else if(!response.body){diagnostic='FORMAT';}
   else{
    diagnostic='FORMAT';const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>65536){diagnostic='OVERSIZE';throw Error('Response limit');}chunks.push(v.value);}}finally{await reader.cancel();}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!value||!Array.isArray(value.data)||value.data.length>1||value.data.some((v:any)=>!v||v.type!=='envelopes'||typeof v.id!=='string'||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.id)))throw Error('Response format');
    state='AUTHENTICATED';diagnostic='OK';
   }
  }catch(e){if((e as any)?.name==='AbortError'||(e as any)?.name==='TimeoutError')diagnostic='TIMEOUT';}
  // Deliberately no response payload, token, resource ID or account-identity assertion.
  return this.rpc(actor,'complete',{requestId:b.requestId,state,diagnostic,httpStatus});
 }
}
