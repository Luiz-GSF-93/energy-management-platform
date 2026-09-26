import type {CpflOperation} from './cpfl-paulista-layout';
export type PreparationValue={key:string;label:string;unit:string;decimal:string|null;state:'EXTRACTED_REVIEW'|'MISSING'|'CONFLICT';sources:string[];reasons:string[]};
const canonical=(v:string)=>{const [whole,fraction='']=v.split('.');const tail=fraction.replace(/0+$/,'');return whole+(tail?'.'+tail:'');};
function add(a:string,b:string){const [aw,af='']=a.split('.'),[bw,bf='']=b.split('.');const scale=Math.max(af.length,bf.length);const n=BigInt(aw+af.padEnd(scale,'0'))+BigInt(bw+bf.padEnd(scale,'0'));if(!scale)return n.toString();const digits=n.toString().padStart(scale+1,'0');return digits.slice(0,-scale)+'.'+digits.slice(-scale);}
/** Read-only mapping of billed TUSD quantities; never sums TE and TUSD or uses rounded history. */
export function cpflPreparationPreview(operations:CpflOperation[]){
 const values:PreparationValue[]=[];
 for(const [period,key,label] of [['PEAK','consumptionPeakKwh','Consumo na ponta'],['OFF_PEAK','consumptionOffPeakKwh','Consumo fora ponta']]){
  const rows=operations.filter(r=>r.component==='TUSD_ENERGY'&&r.period===period&&r.role==='CHARGE');
  const sources=rows.map(r=>r.source),reasons:string[]=[];let decimal:string|null=null;let state:PreparationValue['state']='MISSING';
  if(rows.length>1){state='CONFLICT';reasons.push('MULTIPLE_BILLED_QUANTITIES');}
  else if(rows.length===1){const r=rows[0],q=r.fields.quantity,u=r.fields.unit;const invalid=r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i));
   if(invalid||!q?.decimal||!/^\d+(?:\.\d+)?$/.test(q.decimal)||u?.text.trim().toLowerCase()!=='kwh'||q.issues.includes('UNVERIFIED_SOURCE')||u.issues.includes('UNVERIFIED_SOURCE')){state='CONFLICT';reasons.push('QUANTITY_UNIT_OR_SOURCE_UNVERIFIED');}
   else{decimal=q.decimal;state='EXTRACTED_REVIEW';reasons.push('REVIEW_AND_IDENTITY_REQUIRED');
    const energy=operations.filter(x=>['TE','ACL_DISTRIBUTOR_INFORMATION'].includes(x.component)&&x.period===period&&x.role==='CHARGE');
    for(const e of energy){sources.push(e.source);const eq=e.fields.quantity,eu=e.fields.unit;if(!eq?.decimal||eu?.text.trim().toLowerCase()!=='kwh'||eq.issues.includes('UNVERIFIED_SOURCE')||eu.issues.includes('UNVERIFIED_SOURCE')||canonical(eq.decimal)!==canonical(decimal)){decimal=null;state='CONFLICT';reasons.push('ENERGY_TUSD_QUANTITY_CONFLICT');break;}}
   }
  }else reasons.push('BILLED_TUSD_QUANTITY_MISSING');
  values.push({key,label,unit:'kWh',decimal,state,sources,reasons:[...new Set(reasons)]});
 }
 const [peak,off]=values;const total=peak.decimal!==null&&off.decimal!==null?add(peak.decimal,off.decimal):null;
 values.push({key:'consumptionTotalKwh',label:'Consumo total — ponta + fora ponta',unit:'kWh',decimal:total,state:total===null?'MISSING':'EXTRACTED_REVIEW',sources:[...new Set([...peak.sources,...off.sources])],reasons:[total===null?'TWO_PERIODS_REQUIRED':'REVIEW_AND_IDENTITY_REQUIRED']});
 return {version:'cpfl-preparation-preview-v1',canImport:false,values,pending:[{label:'Demanda medida, contratada e não utilizada',reason:'A quantidade faturada não prova sozinha qual parcela é medida, contratada ou não utilizada.'},{label:'Tarifas, tributos e vigências',reason:'Requerem definição de base, incidência, ambiente e vigência; transcrição não aprova parâmetros.'}],message:'Prévia de campos, sem gravação. Consumo vem do faturamento TUSD; TE serve apenas para conferir a quantidade. Histórico arredondado não substitui estes valores.'};
}
