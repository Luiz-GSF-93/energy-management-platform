import type {OcrAutofill} from './ocr-autofill';
const keys=['consumptionTotal','consumptionPeak','consumptionOffPeak','demandSingle','demandPeak','demandOffPeak','reactiveTotal','reactiveBilledPeakKwh','reactiveBilledOffPeakKwh'];
/** Only fill omissions. An OCR proposal never replaces an operator's saved value. */
export function prefillMeasurements<T extends Record<string,string|null>>(current:T,proposal:OcrAutofill|undefined){
 const measurements={...current};const filled:string[]=[],conflicts:string[]=[];
 for(const key of keys){const value=proposal?.measurements[key];if(value==null||!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))continue;
  if(key==='demandSingle'&&(current.demandPeak!=null||current.demandOffPeak!=null)||['demandPeak','demandOffPeak'].includes(key)&&current.demandSingle!=null||key==='reactiveTotal'&&(current.reactiveBilledPeakKwh!=null||current.reactiveBilledOffPeakKwh!=null)||key.startsWith('reactiveBilled')&&current.reactiveTotal!=null)continue;
  if(current[key]==null||current[key]===''){(measurements as Record<string,string|null>)[key]=value;filled.push(key);}
  else if(Number(current[key])!==Number(value))conflicts.push(key);
 }
 return {measurements,filled,conflicts};
}
export function ocrReviewNote(notes:string,proposal:OcrAutofill){
 const result=[notes.trim(),'Bot-Energy · OK do operador: preenchimentos e fontes conferidos · '+proposal.source+' · validação e publicação permanecem separadas.'].filter(Boolean).join('\n');
 if(result.length>2000)throw Error('As observações excedem o limite. Revise o texto antes de salvar; a conferência não será cortada.');
 return result;
}
