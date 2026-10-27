import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
export const CCEE_DATA_PERMISSIONS={view:'f5364101-4486-42c2-a90f-807937ac3011',manage:'f5364101-4486-42c2-a90f-807937ac3012',review:'f5364101-4486-42c2-a90f-807937ac3013'} as const;
export const CCEE_DATA_FLAGS=['CCEE_DATA_WORKSPACE_ENABLED','CCEE_PRIVATE_READ_ENABLED','CCEE_SYNC_WORKER_ENABLED','CCEE_OFFICIAL_CALENDAR_ENABLED'] as const;
export type ReadingKind='POINTS'|'MEASUREMENTS'|'PLD';
export type MeasurementKind='FINAL'|'CONSOLIDADA'|'FALTANTES';
export function cceeDataEnabled(flag:typeof CCEE_DATA_FLAGS[number]){if(process.env[flag]!=='true')throw new ServiceUnavailableException('Nova função CCEE desligada; aguardando homologação.');}
export function cceeUuid(v:unknown):string{if(typeof v!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v))throw new BadRequestException('Identificador CCEE inválido.');return v.toLowerCase();}
export function cceeMonth(v:unknown,closed=true):string{
 if(typeof v!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v)||v<'2021-01'||closed&&v>=new Date().toISOString().slice(0,7))throw new BadRequestException('Informe uma competência encerrada a partir de 2021.');return v;
}
export function cceeObject(v:unknown,required:string[],optional:string[]=[]):Record<string,any>{
 if(!v||typeof v!=='object'||Array.isArray(v)||required.some(k=>!Object.prototype.hasOwnProperty.call(v,k))||Object.keys(v).some(k=>![...required,...optional].includes(k)))throw new BadRequestException('Campos CCEE inválidos.');return v as Record<string,any>;
}
export function cceeText(v:unknown,max=500,min=3):string{if(typeof v!=='string'||v.trim().length<min||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw new BadRequestException('Texto CCEE inválido.');return v.trim();}
export function calendarSource(value:unknown){
 const u=new URL(cceeText(value,1500));
 if(u.protocol!=='https:'||u.hostname!=='www.ccee.org.br'||u.port||u.username||u.password||u.search||u.hash||!/^\/(?:documents\/|o\/ccee\/documentos\/)[A-Za-z0-9%_./() -]+$/.test(u.pathname))throw new BadRequestException('Use um documento HTTPS oficial da CCEE.');return u.toString();
}
export function dateOnly(v:unknown){if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new BadRequestException('Data CCEE inválida.');return v;}
export function readingCommand(input:unknown){
 const b=cceeObject(input,['requestId','kind','month'],['authorizationId','measurementKind']);cceeUuid(b.requestId);cceeMonth(b.month);
 if(!['POINTS','MEASUREMENTS','PLD'].includes(b.kind))throw new BadRequestException('Serviço de leitura inválido.');
 if(b.kind==='PLD'){if(b.authorizationId||b.measurementKind)throw new BadRequestException('PLD não utiliza ponto privado.');}
 else cceeUuid(b.authorizationId);
 if(b.kind==='MEASUREMENTS'&&!['FINAL','CONSOLIDADA','FALTANTES'].includes(b.measurementKind))throw new BadRequestException('Escolha o tipo de medida.');
 if(b.kind!=='MEASUREMENTS'&&b.measurementKind)throw new BadRequestException('Tipo de medida incompatível.');
 return b;
}
export type PrivateBinding={id:string;organization_id:string;customer_id:string;consumer_unit_id:string;profile_code:string;measurement_point:string;principal_profile_code:string;revision:number;measurement_basis:'UNKNOWN'|'NO_LOSSES'|'WITH_LOSSES';meter_code:string|null;unit_basis?:import('./ccee-private.connector').CceeUnitBasis};
export type CceeReadingJob={id:string;organization_id:string;actor_id:string;kind:ReadingKind;month:string;measurement_kind?:MeasurementKind;environment:'PRODUCTION'|'PILOT';binding:PrivateBinding|null;lease_id:string};
export type ReadingResult={complete:boolean;requests:number;bytes:number;durationMs:number;hashes:string[];transactions:string[];data:any;record?:any;};
