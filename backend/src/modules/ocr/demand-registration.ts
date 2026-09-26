/** Current unit registration is a reference, not an immutable contract history. */
const amount=(v:unknown):string|null=>{if(typeof v!=='string'&&typeof v!=='number')return null;const s=String(v);return /^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(s)?s:null;};
const canonical=(s:string)=>{const [w,f='']=s.split('.');return w+'.'+f.replace(/0+$/,'');};
const same=(a:string|null,b:string|null)=>a!==null&&b!==null&&canonical(a)===canonical(b);
function date(v:unknown):string|null{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v?v:null;}
export function demandRegistration(unit:any,doc:any){
 const result={canImport:false,state:'UNAVAILABLE',month:String(doc?.reference_month??'').slice(0,7),adjustmentDate:null as string|null,values:[] as {label:string;current:string|null;lastAdjustment:string|null}[],message:'Cadastro da unidade indisponível para este documento.'};
 if(!unit||unit.id!==doc.consumer_unit_id||unit.customer_id!==doc.customer_id||unit.organization_id!==doc.organization_id)return result;
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(result.month))return {...result,state:'INVALID_PERIOD',message:'Competência inválida para conferir a vigência.'};
 if(unit.tariff_group!=='A'||!['GREEN','BLUE'].includes(unit.tariff_modality))return {...result,state:'MODALITY_REVIEW',message:'Confira o grupo e a modalidade tarifária no cadastro da unidade.'};
 const fields=unit.tariff_modality==='GREEN'?[['Única','contracted_demand','last_demand_value']]:[['Ponta','contracted_demand_peak','last_demand_peak'],['Fora ponta','contracted_demand_off_peak','last_demand_off_peak']];
 result.values=fields.map(([label,current,last])=>({label,current:amount(unit[current]),lastAdjustment:amount(unit[last])}));
 result.adjustmentDate=date(unit.last_demand_adjustment_date);
 if(result.values.some(x=>x.current===null))return {...result,state:'MISSING_DEMAND',message:'Complete a demanda contratada no cadastro da unidade.'};
 if(!result.adjustmentDate)return {...result,state:'MISSING_DATE',message:'Demanda atual localizada, mas sem data válida do último ajuste. Não comprova a vigência da fatura.'};
 const start=result.month+'-01',end=new Date(Date.UTC(Number(result.month.slice(0,4)),Number(result.month.slice(5,7)),0)).toISOString().slice(0,10);
 if(result.adjustmentDate>end)return {...result,state:'BEFORE_ADJUSTMENT',message:'A fatura é anterior ao último ajuste. É necessário consultar a condição contratual anterior.'};
 if(result.adjustmentDate>start)return {...result,state:'CHANGE_WITHIN_MONTH',message:'O último ajuste ocorreu dentro da competência. Confira as condições de cada período antes de apurar.'};
 if(result.values.some(x=>!same(x.current,x.lastAdjustment)))return {...result,state:'VALUE_CONFLICT',message:'A demanda atual e os valores do último ajuste não coincidem ou estão incompletos. Confira o cadastro.'};
 return {...result,state:'DATED_REFERENCE',message:'Referência cadastral compatível com a data informada. O cadastro não possui histórico completo de vigências: conferir o contrato antes de aprovar a competência.'};
}
export async function loadDemandRegistration(db:any,doc:any){
 try{const r=await db.from('consumer_units').select('id,organization_id,customer_id,tariff_group,tariff_modality,contracted_demand,contracted_demand_peak,contracted_demand_off_peak,last_demand_value,last_demand_peak,last_demand_off_peak,last_demand_adjustment_date').eq('organization_id',doc.organization_id).eq('customer_id',doc.customer_id).eq('id',doc.consumer_unit_id).maybeSingle();return demandRegistration(r.error?null:r.data,doc);}catch{return demandRegistration(null,doc);}
}
