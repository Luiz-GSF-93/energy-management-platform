import {BadRequestException} from '@nestjs/common';
export const AUDIT={view:'dbb580ca-d940-4e80-97fb-e9f9619a0001',ip:'dbb580ca-d940-4e80-97fb-e9f9619a0002',review:'dbb580ca-d940-4e80-97fb-e9f9619a0003',global:'dbb580ca-d940-4e80-97fb-e9f9619a0004',globalReview:'dbb580ca-d940-4e80-97fb-e9f9619a0005'};
export function safeText(value:unknown,limit=500):string|null{
 if(typeof value!=='string')return null;
 return value.replace(/[\x00-\x1f\x7f]/g,' ').replace(/https?:\/\/\S+/gi,'[URL omitida]').replace(/(?:bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|re_[A-Za-z0-9_]{15,}|(?:password|senha|token|secret|api.?key|authorization|cookie|código de liberação)\s*[:=]\s*\S+)/gi,'[segredo omitido]').slice(0,limit).trim()||null;
}
export function auditFilters(q:Record<string,unknown>){
 const allowed=['from','to','page','size','module','actor','action','result','organization','resource','storage'];
 if(Object.keys(q).some(k=>!allowed.includes(k)))throw new BadRequestException('Filtro de auditoria inválido.');
 const page=Number(q.page??0),size=Number(q.size??25);
 if(!Number.isInteger(page)||page<0||page>10000||![25,50,100].includes(size))throw new BadRequestException('Paginação inválida.');
 const to=typeof q.to==='string'?new Date(q.to+'T23:59:59.999Z'):new Date();
 const from=typeof q.from==='string'?new Date(q.from+'T00:00:00Z'):new Date(to.getTime()-30*86400000);
 const earliest=new Date();earliest.setUTCMonth(earliest.getUTCMonth()-24);earliest.setUTCDate(earliest.getUTCDate()-1);
 const storage=q.storage??'PRIMARY';if(!['PRIMARY','HISTORY','ALL'].includes(String(storage))||typeof storage!=='string')throw new BadRequestException('Camada inválida.');
 if(!Number.isFinite(+to)||!Number.isFinite(+from)||from>to||+to-+from>732*86400000||+from<Date.UTC(1900,0,1)||storage==='PRIMARY'&&+from<+earliest)throw new BadRequestException('Selecione até 24 meses por consulta. Para períodos antigos, escolha histórico e origens.');
 const filters:Record<string,unknown>={page,size,from:from.toISOString(),to:to.toISOString(),storage};
 for(const k of ['module','actor','action','result','organization','resource'])if(q[k]!==undefined){if(typeof q[k]!=='string'||(q[k] as string).length>100||!/^[\p{L}\p{N}_.:@ /-]*$/u.test(q[k] as string))throw new BadRequestException('Filtro inválido.');filters[k]=q[k];}
 return filters;
}
