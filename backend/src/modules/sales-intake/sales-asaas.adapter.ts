import {BadRequestException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
export const SANDBOX_URL='https://api-sandbox.asaas.com/v3';
export const paymentId=/^pay_[a-zA-Z0-9]{1,100}$/;
export function cents(value:unknown):number|null {
 if(value===undefined||value===null)return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>10000000||Math.abs(value*100-Math.round(value*100))>0.000001)throw new BadRequestException('Valor financeiro inválido.');
 return Math.round(value*100);
}
export function paymentSummary(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BadRequestException('Cobrança inválida.');
 const p=value as Record<string,unknown>;
 if(typeof p.id!=='string'||!paymentId.test(p.id)||typeof p.status!=='string'||!/^[A-Z_]{1,60}$/.test(p.status)||typeof p.customer!=='string'||!/^cus_[a-zA-Z0-9]{1,100}$/.test(p.customer))throw new BadRequestException('Identificação financeira inválida.');
 // Persist our UUID only; third-party free text may contain contact data.
 const reference=typeof p.externalReference==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p.externalReference)?p.externalReference.toLowerCase():null;
 const gross=cents(p.value),net=cents(p.netValue);
 if(gross===null||net!==null&&net>gross)throw new BadRequestException('Valores financeiros inconsistentes.');
 return {id:p.id,customer:p.customer,status:p.status,reference,grossCents:gross,netCents:net};
}
@Injectable()
export class SalesAsaasAdapter {
 constructor(private readonly config:ConfigService){}
 async payment(id:string){
  if(!paymentId.test(id))throw new BadRequestException('ID Asaas inválido.');
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new ServiceUnavailableException('Consulta externa sandbox desligada ou sem configuração homologada.');
  // No create, update, charge, refund, subscription or provisioning API in stage 4A.
  try {
   const response=await fetch(SANDBOX_URL+'/payments/'+id,{method:'GET',headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4A'},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok||!response.body)throw new Error('Unavailable');
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>65536)throw new Error('Oversize');chunks.push(item.value);}}finally{await reader.cancel();}
   const summary=paymentSummary(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   if(summary.id!==id)throw new Error('Wrong payment');
   return summary;
  }catch{throw new ServiceUnavailableException('Não foi possível conferir a cobrança no sandbox. Evento preservado para nova análise.');}
 }
}
