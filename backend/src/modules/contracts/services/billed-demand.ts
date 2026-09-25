// Explicit reviewed billing quantities. Never derive them from measured/contracted demand.
const decimal=/^(0|[1-9][0-9]{0,11})([.][0-9]{1,6})?$/;
export function normalizeBilledDemand(input:any){
 if(input==null)return null;
 return Object.fromEntries(['ACL','ACR'].filter(s=>input[s]!=null).map(s=>[s,{single:input[s].single??null,peak:input[s].peak??null,offPeak:input[s].offPeak??null,source:input[s].source.trim()}]));
}
export function billedDemandIssues(input:any,context:any,validating=false):string[]{
 if(input==null)return [];
 const errors:string[]=[];
 if(typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['ACL','ACR'].includes(k)))return ['Estrutura da demanda faturável inválida.'];
 for(const s of ['ACL','ACR']){
  const d=input[s];if(d==null)continue;
  if(typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['single','peak','offPeak','source'].includes(k))||typeof d.source!=='string'||!d.source.trim()||d.source.length>2000||['single','peak','offPeak'].some(k=>d[k]!=null&&(typeof d[k]!=='string'||!decimal.test(d[k])))){errors.push(s+': informe quantidades decimais válidas e a fonte da demanda faturável.');continue;}
  if(d.single!=null&&(d.peak!=null||d.offPeak!=null))errors.push(s+': use demanda faturável única ou por posto.');
  if(validating){
   if(context?.tariff_group!=='A'||!['BLUE','GREEN'].includes(context?.tariff_modality))errors.push(s+': demanda faturável disponível para grupo A azul ou verde.');
   else if(context.tariff_modality==='BLUE'&&(d.single!=null||d.peak==null||d.offPeak==null))errors.push(s+': azul exige demanda faturável de ponta e fora ponta.');
   else if(context.tariff_modality==='GREEN'&&(d.single==null||d.peak!=null||d.offPeak!=null))errors.push(s+': verde exige demanda faturável única.');
  }
 }
 return errors;
}
