import {BadRequestException} from '@nestjs/common';

export const MAP_VIEW='b142bd7b-05a3-45ee-befd-e593066c2775';
export const MAP_CUSTOMERS='cbb2e904-0718-4eec-9396-dba899118cdd';
export const MAP_MANAGE='0f2e539d-03f9-4168-bc8c-55ac3a371628';
export function mapId(value:unknown):string {
 if(typeof value!=='string'||!value.trim()||value.length>200||/[\x00-\x1f]/.test(value))throw new BadRequestException('Identificador inválido.');
 return value;
}
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new BadRequestException('Campos inválidos.');
 return value as Record<string,unknown>;
}
export function locationInput(value:unknown){
 const b=record(value),keys=['latitude','longitude','precision','reason','revision','requestId','checkedAddress','addressHash'];
 if(Object.keys(b).some(k=>!keys.includes(k))||keys.some(k=>!(k in b)))throw new BadRequestException('Revise os campos de localização.');
 if(typeof b.latitude!=='number'||!Number.isFinite(b.latitude)||b.latitude< -90||b.latitude>90||typeof b.longitude!=='number'||!Number.isFinite(b.longitude)||b.longitude< -180||b.longitude>180||(b.latitude===0&&b.longitude===0))throw new BadRequestException('Informe latitude e longitude válidas; não use 0,0 como padrão.');
 if(!['ADDRESS','STREET','POSTCODE','CITY'].includes(String(b.precision))||b.checkedAddress!==true||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>500||!Number.isSafeInteger(b.revision)||(b.revision as number)<0||typeof b.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.requestId))throw new BadRequestException('Confira o endereço, a precisão e a justificativa antes de salvar.');
 if(typeof b.addressHash!=='string'||!/^[a-f0-9]{32}$/.test(b.addressHash))throw new BadRequestException('Atualize o endereço antes de salvar.');
 return {...b,reason:b.reason.trim()};
}
export function mapQuery(value:unknown){
 const q=record(value),keys=['search','state','city','distributor','customerId','market','gd','bess','location','status','offset','limit','radiusLatitude','radiusLongitude','radiusKm'];
 if(Object.keys(q).some(k=>!keys.includes(k)))throw new BadRequestException('Filtro inválido.');
 const text=(key:string,max=100)=>{const v=q[key];if(v===undefined||v==='')return null;if(typeof v!=='string'||v.length>max||/[\x00-\x1f]/.test(v))throw new BadRequestException('Filtro inválido.');return v.trim()||null;};
 const integer=(key:string,fallback:number,max:number)=>{if(q[key]===undefined)return fallback;if(typeof q[key]!=='string'||!/^\d{1,7}$/.test(q[key] as string))throw new BadRequestException('Paginação inválida.');const n=Number(q[key]);if(n>max)throw new BadRequestException('Paginação inválida.');return n;};
 const bess=text('bess');if(bess&&!['YES','NO','UNKNOWN'].includes(bess))throw new BadRequestException('Filtro BESS inválido.');
 const gd=text('gd');if(gd&&!['YES','NO','UNKNOWN'].includes(gd))throw new BadRequestException('Filtro GD inválido.');
 const market=text('market'),location=text('location'),status=text('status');
 if(market&&!['ACL','ACR','UNKNOWN'].includes(market)||location&&!['CONFIRMED','PENDING','STALE'].includes(location)||status&&!['ACTIVE','INACTIVE','MIGRATED','CHURN','SEASONAL'].includes(status))throw new BadRequestException('Filtro inválido.');
 const limit=integer('limit',200,500);if(limit<1)throw new BadRequestException('Limite inválido.');
 return {...mapRadius(q),search:text('search'),state:text('state',50),city:text('city',255),distributor:text('distributor'),customerId:text('customerId',200),market,gd,bess,location,status,offset:integer('offset',0,1000000),limit};
}

export function mapRadius(q:Record<string,unknown>){
 const keys=['radiusLatitude','radiusLongitude','radiusKm'],values=keys.map(k=>q[k]);
 if(values.every(v=>v===undefined||v===''))return {radiusLatitude:null,radiusLongitude:null,radiusKm:null};
 if(values.some((v,i)=>typeof v!=='string'||!(i===2?/^\d{1,3}(\.\d{1,3})?$/:/^-?\d{1,3}(\.\d{1,7})?$/).test(v as string)))throw new BadRequestException('Informe centro e raio completos.');
 const [latitude,longitude,km]=values.map(Number);
 if(latitude< -90||latitude>90||longitude< -180||longitude>180||km<1||km>500)throw new BadRequestException('Raio entre 1 e 500 km e coordenadas válidas.');
 return {radiusLatitude:latitude,radiusLongitude:longitude,radiusKm:km};
}
