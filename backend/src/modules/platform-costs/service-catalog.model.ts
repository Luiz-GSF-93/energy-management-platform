import {BadRequestException} from '@nestjs/common';
export const COST_SERVICE_STATES=['ACTIVE','PLANNED','DISABLED'] as const;
export const COST_SERVICE_ENVIRONMENTS=['PRODUCTION','SANDBOX','SHARED','PLANNED'] as const;
export const COST_SERVICE_CATEGORIES=['AI','OCR','STORAGE','DATABASE','SERVER','NETWORK','BACKUP','WEB','COMMUNICATIONS','SIGNATURE','PAYMENT','OTHER'] as const;
export const COST_SERVICE_SOURCES=['TELEMETRY','PROVIDER_INVOICE','MANUAL_ESTIMATE','NOT_CONNECTED'] as const;
export type CostServiceDefinition={code:string;name:string;provider:string;category:string;environment:string;state:string;costSource:string;resourceReference:string;sourceUrl:string;notes:string;checkedOn:string|null;budgetMinor:number|null;budgetCurrency:string|null;expenseIds:string[]};
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function reject():never{throw new BadRequestException('Confira campos, origem e referência do catálogo.');}
export function catalogPage(v:unknown){const s=v??'0';if(!/^\d{1,4}$/.test(String(s))||Number(s)>1000)reject();return Number(s);}
export function catalogMonth(v:unknown){if(typeof v!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)||(Number(v.slice(0,4))<2000||Number(v.slice(0,4))>2199))reject();return v.toLowerCase();}
export function catalogUuid(v:unknown){if(typeof v!=='string'||!uuid.test(v))reject();return v.toLowerCase();}
export function catalogFilter(v:Record<string,unknown>){const keys=['page','month','search','provider','category','environment','state','costSource'];if(Object.keys(v).some(k=>!keys.includes(k)))reject();const r:any={page:catalogPage(v.page),month:catalogMonth(v.month)};for(const k of keys.slice(2)){const x=v[k]??'';if(typeof x!=='string'||x.length>100||/[\x00-\x1f\x7f]/.test(x))reject();r[k]=x;}for(const [k,values]of [['category',COST_SERVICE_CATEGORIES],['environment',COST_SERVICE_ENVIRONMENTS],['state',COST_SERVICE_STATES],['costSource',COST_SERVICE_SOURCES]]as const)if(r[k]&&!values.includes(r[k]as never))reject();return r;}
export function catalogCommand(v:unknown){
 if(!v||typeof v!=='object'||Array.isArray(v))reject();const b=v as any;
 const keys=['requestId','expectedRevisionId','justification','definition'];if(Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k)))reject();catalogUuid(b.requestId);if(b.expectedRevisionId!==null)catalogUuid(b.expectedRevisionId);
 if(typeof b.justification!=='string'||b.justification.trim().length<20||b.justification.length>1000||/[\x00-\x1f\x7f]/.test(b.justification))reject();
 const d=b.definition;const fields=['code','name','provider','category','environment','state','costSource','resourceReference','sourceUrl','notes','checkedOn','budgetMinor','budgetCurrency','expenseIds'];if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).length!==fields.length||Object.keys(d).some(k=>!fields.includes(k)))reject();
 for(const [k,max,min]of [['code',80,3],['name',120,3],['provider',80,1],['resourceReference',800,0],['sourceUrl',1024,0],['notes',1000,20]]as const)if(typeof d[k]!=='string'||d[k].length>max||d[k].trim().length<min||/[\x00-\x1f\x7f]/.test(d[k]))reject();
 if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.code))reject();for(const[k,values]of [['category',COST_SERVICE_CATEGORIES],['environment',COST_SERVICE_ENVIRONMENTS],['state',COST_SERVICE_STATES],['costSource',COST_SERVICE_SOURCES]]as const)if(!values.includes(d[k]as never))reject();
 if(d.sourceUrl){let u:URL;try{u=new URL(d.sourceUrl);}catch{reject();}if(u!.protocol!=='https:'||u!.username||u!.password||u!.search||u!.hash)reject();}
 if(d.checkedOn!==null&&(typeof d.checkedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.checkedOn)||!Number.isFinite(Date.parse(d.checkedOn+'T00:00:00Z'))||new Date(d.checkedOn+'T00:00:00Z').toISOString().slice(0,10)!==d.checkedOn))reject();
 if(d.budgetMinor===null?d.budgetCurrency!==null:!Number.isSafeInteger(d.budgetMinor)||d.budgetMinor<0||d.budgetMinor>1e12||!['BRL','USD'].includes(d.budgetCurrency))reject();
 if(!Array.isArray(d.expenseIds)||d.expenseIds.length>24||new Set(d.expenseIds).size!==d.expenseIds.length)reject();d.expenseIds=d.expenseIds.map(catalogUuid);if(new Set(d.expenseIds).size!==d.expenseIds.length)reject();
 return {...b,requestId:catalogUuid(b.requestId),expectedRevisionId:b.expectedRevisionId===null?null:catalogUuid(b.expectedRevisionId),justification:b.justification.trim(),definition:d as CostServiceDefinition};
}
export const COST_SERVICE_PRESETS=[
 ['ccee-integration','CCEE · integração, processamento e tráfego','CCEE / infraestrutura EnergyOS','SERVER','PLANNED','PLANNED','NOT_CONNECTED'],
 ['azure-openai','Azure OpenAI · EVA e interpretação','Microsoft Azure','AI','PRODUCTION','ACTIVE','TELEMETRY'],
 ['azure-embeddings','Azure OpenAI · embeddings','Microsoft Azure','AI','PRODUCTION','ACTIVE','TELEMETRY'],
 ['azure-ocr','Azure Document Intelligence · páginas OCR','Microsoft Azure','OCR','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['eva-blob','EVA · originais Blob','Microsoft Azure','STORAGE','SANDBOX','ACTIVE','MANUAL_ESTIMATE'],
 ['azure-ai-search','Azure AI Search','Microsoft Azure','AI','PLANNED','PLANNED','NOT_CONNECTED'],
 ['azure-foundry','Foundry · projeto e recursos associados','Microsoft Azure','AI','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['azure-network','Azure · rede e monitoramento','Microsoft Azure','NETWORK','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['railway-backend','Railway · backend e tráfego','Railway','SERVER','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['railway-postgres','Railway · PostgreSQL e volumes','Railway','DATABASE','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['vercel-frontend','Frontend EnergyOS','Vercel','WEB','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['cloudflare-site','Site, DNS e serviços associados','Cloudflare','WEB','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['meta-whatsapp','WhatsApp · mensagens','Meta','COMMUNICATIONS','PRODUCTION','ACTIVE','NOT_CONNECTED'],
 ['asaas-finance','Asaas · taxas e serviços','Asaas','PAYMENT','SANDBOX','ACTIVE','NOT_CONNECTED'],
 ['clicksign-api','Clicksign · assinatura e API','Clicksign','SIGNATURE','SHARED','ACTIVE','NOT_CONNECTED'],
 ['backup-recovery','Backup e recuperação','A conferir','BACKUP','SHARED','PLANNED','NOT_CONNECTED'],
].map(([code,name,provider,category,environment,state,costSource])=>({code,name,provider,category,environment,state,costSource,resourceReference:'',sourceUrl:'',notes:'Modelo inicial para conferência pelo Owner. O estado e o ambiente precisam ser confirmados; não prova contratação, custo zero ou faturamento.',checkedOn:null,budgetMinor:null,budgetCurrency:null,expenseIds:[]}));
