import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {tariffProduct} from '../contracts/services/tariff-preview';
import type {CpflOperation} from '../ocr/cpfl-paulista-layout';
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\b(TE|TUSD)(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*\d{2,4}\b/g,'$1').trim();
const off=(s:string)=>/\b(?:FPONTA|F PONTA|FORA PONTA|FORA DE PONTA)\b/.test(norm(s));
export const decimal=(v:unknown):bigint=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?$/.test(v))throw Error('Quantidade ou preço indisponível.');const [a,b='']=v.split('.');return BigInt(a)*1000000000n+BigInt(b.padEnd(9,'0'));};
export const quantity=(v:bigint)=>{const s=v.toString().padStart(10,'0');return s.slice(0,-9)+'.'+s.slice(-9);};
export const specificPrice=(amount:bigint,kwh:bigint)=>kwh>0n?feeMoney((amount*1000n*1000000000n+kwh/2n)/kwh):null;
type Line={amount:string;quantity:string;grossRate:string;netRate:string|null;source:string;pages:number[]};
export type EnergyReference={state:'AVAILABLE'|'BLOCKED';month:string|null;peak?:Line;off?:Line;gd?:Line|null;reason?:string;reviewRequired?:boolean};
/** Only energy TE and its own GD credit. TUSD, bands, fees and demand are excluded. */
export function energyReference(operations:CpflOperation[],month:string|null):EnergyReference{
 const blocked=(reason:string):EnergyReference=>({state:'BLOCKED',month,reason});
 const injected=(o:CpflOperation)=>/^ENERGIA (?:ATV|ATIVA) (?:INJ|INJETADA)\b/.test(norm(o.fields.description?.text??''));
 const te=operations.filter(o=>o.component==='TE'&&o.role==='CHARGE'&&!injected(o));
 const peak=te.filter(o=>o.period==='PEAK'),outside=te.filter(o=>o.period==='OFF_PEAK'||off(o.fields.description?.text??''));
 const gd=operations.filter(o=>injected(o)&&/\bTE\b/.test(norm(o.fields.description?.text??'')));
 if(!month||peak.length!==1||outside.length!==1||gd.length>1)return blocked('Fonte TE ponta/fora ponta ou crédito GD ambígua.');
 try{const line=(o:CpflOperation):Line=>{const f=o.fields,a=f.amount?.decimal,q=f.quantity?.decimal,g=f.grossRate?.decimal;
 if(!a||!q||!g||[f.description,f.unit,f.amount,f.quantity,f.grossRate].some(v=>!v?.pages.length||!v.spans.length||v.issues.some(i=>!['MISSING_CONFIDENCE','CONFIDENCE_REQUIRES_REVIEW'].includes(i)))||o.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i))||f.unit?.text.trim().toLowerCase()!=='kwh'||!f.amount?.pages.length)throw Error('Linha TE não conciliada.');
 if(injected(o)?!a.startsWith('-'):a.startsWith('-'))throw Error('Sinal de crédito/débito TE inválido.');
 const abs=a.startsWith('-')?a.slice(1):a,delta=feeCents(tariffProduct(q,g).rounded)-feeCents(abs);if(delta>1n||delta< -1n)throw Error('Valor TE não concilia com quantidade e tarifa.');
 const n=f.aneelRate?.pages.length&&f.aneelRate.spans.length&&!f.aneelRate.issues.some(i=>!['MISSING_CONFIDENCE','CONFIDENCE_REQUIRES_REVIEW'].includes(i))?f.aneelRate.decimal:null;if(n&&decimal(n)>decimal(g))throw Error('Tarifa sem tributos maior que tarifa final.');
 return {amount:abs,quantity:q,grossRate:g,netRate:n,source:o.source,pages:f.amount.pages};};
 return {state:'AVAILABLE',reviewRequired:true,month,peak:line(peak[0]),off:line(outside[0]),gd:gd.length?line(gd[0]):null};
 }catch{return blocked('Quantidade, tarifas e tributos da TE exigem conferência.');}
}
export function baselineFromStudy(result:any){
 const ref:EnergyReference|undefined=result.location?.energyReference;
 if(!ref||ref.state!=='AVAILABLE'||!ref.peak||!ref.off)return {state:'PENDING',reason:'Registre nova versão com referência TE segregada e conferida.'};
 if(!Array.isArray(result.rows)||result.rows.length!==12)return {state:'PENDING',reason:'A referência anual exige 12 meses completos.'};
 const gd=result.gdHistory?.rows;if(ref.gd&&(!Array.isArray(gd)||gd.length!==12))return {state:'PENDING',reason:'Créditos TE de GD históricos precisam de hipótese explícita nos 12 meses.'};
 let gross=0n,net=0n,kwh=0n;const netAvailable=!!ref.peak.netRate&&!!ref.off.netRate&&(!ref.gd||!!ref.gd.netRate);
 const rows=result.rows.map((row:any)=>{
 const documentary=row.sourceMonth===ref.month,p=documentary?ref.peak!.quantity:row.peakKwh,o=documentary?ref.off!.quantity:row.offPeakKwh;
 const volume=decimal(p)+decimal(o);if(volume<=0n)throw Error('Consumo anual sem base positiva.');
 const credit=ref.gd?(documentary?ref.gd.quantity:gd.find((g:any)=>g.month===row.month)?.gdKwh):null;
 if(ref.gd&&typeof credit!=='string')throw Error('Crédito GD ausente; não foi convertido em zero.');
 const cost=(rateKey:'grossRate'|'netRate')=>{
  const te=documentary&&rateKey==='grossRate'?feeCents(ref.peak!.amount)+feeCents(ref.off!.amount):feeCents(tariffProduct(p,ref.peak![rateKey]!).rounded)+feeCents(tariffProduct(o,ref.off![rateKey]!).rounded);
  const compensation=ref.gd?(documentary&&rateKey==='grossRate'?feeCents(ref.gd.amount):feeCents(tariffProduct(credit!,ref.gd[rateKey]!).rounded)):0n;
  if(compensation>te)throw Error('Crédito TE excede o custo de energia; referência bloqueada.');return te-compensation;
 };
 const g=cost('grossRate'),n=netAvailable?cost('netRate'):null;gross+=g;if(n!==null)net+=n;kwh+=volume;
 return {sourceMonth:row.sourceMonth,kwh:quantity(volume),grossTe:feeMoney(g),netTe:n===null?null:feeMoney(n),gdEstimated:!!ref.gd&&!documentary};
 });
 const ordered=rows.map((r:any)=>r.sourceMonth).sort();
 if(new Set(ordered).size!==12||ordered.some((m:any,i:number)=>typeof m!=='string'||!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(m)||i>0&&(Number(m.slice(0,4))*12+Number(m.slice(5))!==Number(ordered[i-1].slice(0,4))*12+Number(ordered[i-1].slice(5))+1)))throw Error('Histórico anual repetido ou não consecutivo.');
 const b=result.proposal?.energyBasis;let contractNet:string|null=null;
 if(b?.checked===true&&b.method==='LOSS_UPLIFT_ICMS_INSIDE'){const loss=decimal(b.lossPercent);if(loss>100000000000n)throw Error('Perdas fora do intervalo.');contractNet=feeMoney((decimal(b.baseBrlMwh)*(100000000000n+loss)*100n+50000000000000000000n)/100000000000000000000n);}
 return {state:'AVAILABLE',method:'ANNUAL_ENERGY_WEIGHTED_GD_TE',submarket:result.location?.code??null,estimated:true,months:rows,annualKwh:quantity(kwh),contractNetBrlMwh:contractNet,annualGrossTe:feeMoney(gross),annualNetTe:netAvailable?feeMoney(net):null,grossBrlMwh:specificPrice(gross,kwh),netBrlMwh:netAvailable?specificPrice(net,kwh):null,from:rows.map((r:any)=>r.sourceMonth).sort()[0],to:rows.map((r:any)=>r.sourceMonth).sort()[11],disclosure:'Referência estimada com tarifas fixas do cenário e histórico aprovado. TE ponta/fora ponta com tributos, menos crédito GD de TE; exclui TUSD, demanda, bandeira, encargos e honorários. Não comprova 12 faturas pagas.'};
}
export function indicativePrice(acrNet:string|null,aclNet:string|null){
 if(acrNet===null||aclNet===null)return {value:null,notice:'não contém tributo na indicação',reason:'Referências líquidas de tributos incompletas; não presume alíquota.'};
 const a=feeCents(acrNet),b=feeCents(aclNet);return {value:feeMoney(a<b?a:b),notice:'não contém tributo na indicação',reason:'Referência inicial: menor entre TE ACR anual e compra ACL média, ambas sem tributos. Comparação indicativa; prazo, volume, perdas, flexibilidade e risco exigem análise do Consultor.'};
}
