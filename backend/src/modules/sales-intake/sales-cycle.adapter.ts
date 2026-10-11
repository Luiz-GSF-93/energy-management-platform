import {Injectable,ServiceUnavailableException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {paymentId,paymentSummary,SANDBOX_URL} from './sales-asaas.adapter';
@Injectable()
export class SalesCycleAdapter {
 constructor(private readonly config:ConfigService){}
 async payment(id:string){
  const key=this.config.get<string>('SALES_ASAAS_SANDBOX_API_KEY');
  if(!paymentId.test(id)||this.config.get('SALES_CYCLE_CHECKS_ENABLED')!=='true'||this.config.get('SALES_CYCLE_CHECKS_CALLS_ENABLED')!=='true'||this.config.get('SALES_ASAAS_SANDBOX_ENABLED')!=='true'||this.config.get('SALES_ASAAS_BASE_URL')!==SANDBOX_URL||!key||key.length<20)throw new ServiceUnavailableException('Conferência de ciclos sandbox desligada.');
  try{
   const response=await fetch(SANDBOX_URL+'/payments/'+id,{method:'GET',headers:{access_token:key,'User-Agent':'EnergyOS-Sandbox-4G'},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok||!response.body)throw new Error();
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
   try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>65536)throw new Error();parts.push(r.value);}}finally{await reader.cancel();}
   const raw=JSON.parse(Buffer.concat(parts).toString('utf8')),summary=paymentSummary(raw);
   if(summary.id!==id||typeof raw.subscription!=='string'||!/^sub_[a-zA-Z0-9]{1,100}$/.test(raw.subscription)||typeof raw.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate)||!Number.isFinite(Date.parse(raw.dueDate+'T00:00:00Z'))||new Date(raw.dueDate+'T00:00:00Z').toISOString().slice(0,10)!==raw.dueDate)throw new Error();
   return {...summary,status:raw.deleted===true?'DELETED':summary.status,subscription:raw.subscription,dueDate:raw.dueDate};
  }catch{throw new ServiceUnavailableException('Cobrança recorrente não conferida; histórico preservado.');}
 }
}
