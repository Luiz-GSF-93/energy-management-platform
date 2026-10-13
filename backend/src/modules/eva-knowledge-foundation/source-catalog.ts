/** Discovery descriptors, not imported documents, reviewed norms or training examples. */
export const SOURCE_CATALOG_VERSION='eva-source-discovery-v1';
export const SOURCE_CATALOG=Object.freeze([
 {key:'ANEEL_RULES',authority:'ANEEL',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:'https://www.gov.br/aneel/pt-br',state:'NOT_IMPORTED'},
 {key:'PRORET',authority:'ANEEL',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:'https://www.gov.br/aneel/pt-br/centrais-de-conteudos/procedimentos-regulatorios/proret',state:'NOT_IMPORTED'},
 {key:'PRODIST',authority:'ANEEL',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:'https://www.gov.br/aneel/pt-br/centrais-de-conteudos/procedimentos-regulatorios/prodist',state:'NOT_IMPORTED'},
 {key:'LEGISLATION',authority:'PLANALTO',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:'https://www.planalto.gov.br/',state:'NOT_IMPORTED'},
 {key:'CCEE_RULES',authority:'CCEE',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:'https://www.ccee.org.br/web/guest/mercado/regras-de-comercializacao',state:'NOT_IMPORTED'},
 {key:'CCEE_PROCEDURES',authority:'CCEE',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:'https://www.ccee.org.br/web/guest/mercado/procedimentos-de-comercializacao',state:'NOT_IMPORTED'},
 {key:'ONS_PROCEDURES',authority:'ONS',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:'https://www.ons.org.br/paginas/sobre-o-ons/procedimentos-de-rede/vigentes',state:'NOT_IMPORTED'},
 {key:'DISTRIBUTOR_DOCUMENTS',authority:'DISTRIBUTOR',kind:'OFFICIAL',scope:'OFFICIAL_PUBLIC',url:null,state:'REGISTRY_REQUIRED'},
 {key:'ENERGYOS_GUIDES',authority:'ENERGYOS',kind:'PRODUCT_GUIDE',scope:'PRODUCT',url:null,state:'REVIEW_REQUIRED'},
 {key:'EXPERT_ENERGY_METHODS',authority:'EXPERT_ENERGY',kind:'SPECIALIST',scope:'PLATFORM_INTERNAL',url:null,state:'REVIEW_REQUIRED'},
 {key:'ORGANIZATION_MANUALS',authority:'ORGANIZATION',kind:'SPECIALIST',scope:'ORGANIZATION',url:null,state:'REVIEW_REQUIRED'},
 {key:'UNIT_OPERATIONAL_EVIDENCE',authority:'ENERGYOS_API',kind:'OPERATIONAL',scope:'CLIENT_UNIT',url:null,state:'AUTHORIZATION_REQUIRED'},
] as const);

/** URL classification only; no fetch or DNS lookup. A future downloader needs its own SSRF boundary. */
export function knownOfficialDiscoveryUrl(authority:string,value:string){
 try{
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return false;
  if(authority==='ANEEL')return ['www.aneel.gov.br','www2.aneel.gov.br','biblioteca.aneel.gov.br','git.aneel.gov.br'].includes(u.hostname)||u.hostname==='www.gov.br'&&u.pathname.startsWith('/aneel/');
  if(authority==='PLANALTO')return ['www.planalto.gov.br','planalto.gov.br'].includes(u.hostname);
  if(authority==='CCEE')return ['www.ccee.org.br','ccee.org.br'].includes(u.hostname);
  if(authority==='ONS')return ['www.ons.org.br','ons.org.br','ecmservice.ons.org.br','proxyportais.ons.org.br'].includes(u.hostname);
  return false; // Distributor registration and proprietary material require explicit separate admission.
 }catch{return false;}
}
