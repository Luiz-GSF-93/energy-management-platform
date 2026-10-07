import {createSecureContext} from 'node:tls';

export type CceeConfig = {organizationId:string; profile:string; username:string; password:string; pfx:Buffer; passphrase:string; ca?:string};
export const CCEE_HOST = 'servicos.ccee.org.br';
export function cceeConfig(env:NodeJS.ProcessEnv):CceeConfig {
  const names=['CCEE_ORGANIZATION_ID','CCEE_PROFILE_CODE','CCEE_USERNAME','CCEE_PASSWORD','CCEE_PFX_BASE64','CCEE_PFX_PASSWORD'];
  if(env.CCEE_READ_ENABLED!=='true'||names.some(name=>!env[name])) throw new Error('CCEE_NOT_CONFIGURED');
  if(env.CCEE_PASSWORD!.length>4096||env.CCEE_PFX_PASSWORD!.length>4096)throw new Error('CCEE_INVALID_CONFIG');
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(env.CCEE_ORGANIZATION_ID!)||!/^\d{1,12}$/.test(env.CCEE_PROFILE_CODE!)||!/^\d{1,30}$/.test(env.CCEE_USERNAME!)) throw new Error('CCEE_INVALID_CONFIG');
  const encoded=env.CCEE_PFX_BASE64!;
  if(encoded.length>100000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('CCEE_INVALID_CONFIG');
  const pfx=Buffer.from(encoded,'base64');
  if(pfx.length<500) throw new Error('CCEE_INVALID_CONFIG');
  const config={organizationId:env.CCEE_ORGANIZATION_ID!,profile:env.CCEE_PROFILE_CODE!,username:env.CCEE_USERNAME!,password:env.CCEE_PASSWORD!,pfx,passphrase:env.CCEE_PFX_PASSWORD!,ca:env.CCEE_SERVER_CA_PEM};
  try {createSecureContext({pfx,passphrase:config.passphrase,ca:config.ca,minVersion:'TLSv1.2',maxVersion:'TLSv1.2'});} catch {pfx.fill(0);throw new Error('CCEE_INVALID_CERTIFICATE');}
  return config;
}

export function xmlEscape(value:string):string {
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('CCEE_INVALID_CONFIG');
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
export function soapRequest(config:CceeConfig,kind:'profile'|'pld',page:number,month?:string):string {
  if(!Number.isInteger(page)||page<1||page>20) throw new Error('CCEE_INVALID_PAGE');
  const version=kind==='profile'?'v2':'v1';
  let body:string;
  if(kind==='profile') body=`<bm:listarPerfilParticipanteMercadoRequest><bm:perfilParticipanteMercado><bo:codigo>${config.profile}</bo:codigo></bm:perfilParticipanteMercado></bm:listarPerfilParticipanteMercadoRequest>`;
  else {
    if(!month||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month<'2021-01') throw new Error('CCEE_INVALID_MONTH');
    const [year,number]=month.split('-').map(Number);
    const last=new Date(Date.UTC(year,number,0)).getUTCDate();
    body=`<bm:listarPLDRequest><bm:plds><bm:pld><bo:vigencia><bo:inicio>${month}-01T00:00:00</bo:inicio><bo:fim>${month}-${last}T00:00:00</bo:fim></bo:vigencia><bo:valores><bo:valor><bo:tipo>HORARIO</bo:tipo></bo:valor></bo:valores></bm:pld></bm:plds></bm:listarPLDRequest>`;
  }
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:mh="http://xmlns.energia.org.br/MH/${version}" xmlns:bm="http://xmlns.energia.org.br/BM/${version}" xmlns:bo="http://xmlns.energia.org.br/BO/${version}" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soapenv:Header><mh:messageHeader><mh:codigoPerfilAgente>${config.profile}</mh:codigoPerfilAgente>${kind==='profile'?'<mh:versao>2.1</mh:versao>':''}</mh:messageHeader><wsse:Security><wsse:UsernameToken><wsse:Username>${xmlEscape(config.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${xmlEscape(config.password)}</wsse:Password></wsse:UsernameToken></wsse:Security><mh:paginacao><mh:numero>${page}</mh:numero><mh:quantidadeItens>${kind==='profile'?2:100}</mh:quantidadeItens></mh:paginacao></soapenv:Header><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}
