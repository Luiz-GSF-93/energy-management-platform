import {Injectable} from '@nestjs/common';
import {ANEEL_FLAG_URLS,flagHash,parseFlagFeeds} from './aneel-tariff-flags.model';
@Injectable()
export class AneelTariffFlagsConnector{
 constructor(private fetcher:typeof fetch=fetch){}
 async read(reserve:()=>Promise<void>,today:string){
  const buffers:Buffer[]=[],documents:any[]=[];
  for(const url of ANEEL_FLAG_URLS){
   await reserve();const response=await this.fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Accept:'text/csv','User-Agent':'EnergyOS-official-tariff-monitor/1.0'}});
   if(!response.ok||response.url&&response.url!==url||!response.body)throw Error('OFFICIAL_SOURCE_UNAVAILABLE');
   if(!/^(text\/(csv|plain)|application\/(csv|octet-stream))(;|$)/i.test(response.headers.get('content-type')??''))throw Error('OFFICIAL_SOURCE_FORMAT');
   if(Number(response.headers.get('content-length')??0)>2_000_000)throw Error('SOURCE_TOO_LARGE');
   const parts:Uint8Array[]=[];let size=0;const reader=response.body.getReader();try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>2_000_000)throw Error('SOURCE_TOO_LARGE');parts.push(r.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const bytes=Buffer.concat(parts);buffers.push(bytes);documents.push({url,hash:flagHash(bytes),raw:bytes.toString('base64')});
  }
  return {documents,rows:parseFlagFeeds(buffers[0],buffers[1],today)};
 }
}
