import {ForbiddenException,ServiceUnavailableException} from '@nestjs/common';
import {Request} from 'express';
import {isIP} from 'net';

function singleHeader(req:Request,name:string):string|undefined {
 const value=req.headers[name];
 const count=req.rawHeaders.filter((_,index)=>index%2===0&&req.rawHeaders[index].toLowerCase()===name).length;
 return count===1&&typeof value==='string'&&value===value.trim()?value:undefined;
}

function canonicalIp(value:string):string|undefined {
 const family=isIP(value);
 if(family===4)return value;
 if(family!==6)return undefined;
 const normalized=new URL('http://['+value+']/').hostname.slice(1,-1);
 // IPv4-mapped IPv6 and its IPv4 spelling must share the same quota.
 const mapped=/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normalized);
 if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);return [high>>8,high&255,low>>8,low&255].join('.');}
 return normalized;
}

/** Only for the direct Railway public ingress. Headers do not authenticate internal services. */
export function salesRequesterIp(req:Request):string {
 if(process.env.SALES_INTAKE_IP_SOURCE!=='railway-public'){
  if(process.env.NODE_ENV==='production')throw new ServiceUnavailableException('Ingresso comercial não configurado.');
  const direct=canonicalIp(req.socket.remoteAddress||'');
  if(!direct)throw new ForbiddenException('Ingresso comercial não autorizado.');
  return direct;
 }
 const expected=process.env.SALES_INTAKE_PUBLIC_HOST;
 if(!expected||!expected.endsWith('.up.railway.app')||!/^[a-z0-9.-]+$/.test(expected)||!process.env.RAILWAY_PROJECT_ID)
  throw new ServiceUnavailableException('Ingresso comercial não configurado.');
 const host=singleHeader(req,'host'),ip=singleHeader(req,'x-real-ip');
 const edge=singleHeader(req,'x-railway-edge'),requestId=singleHeader(req,'x-railway-request-id');
 const proto=singleHeader(req,'x-forwarded-proto');
 if(host!==expected||proto!=='https'||!edge||!/^[a-z0-9-]{2,80}$/i.test(edge)||!requestId||!/^[a-z0-9_-]{16,128}$/i.test(requestId)||!ip)
  throw new ForbiddenException('Ingresso comercial não autorizado.');
 const normalized=canonicalIp(ip);
 if(!normalized)throw new ForbiddenException('Ingresso comercial não autorizado.');
 // Never use caller-supplied Forwarded, CF-Connecting-IP or X-Forwarded-For.
 return normalized;
}
