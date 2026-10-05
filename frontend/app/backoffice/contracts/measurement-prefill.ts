import type {OcrAutofill} from './ocr-autofill';
const keys=['consumptionTotal','consumptionPeak','consumptionOffPeak','demandSingle','demandPeak','demandOffPeak','reactiveTotal','reactiveBilledPeakKwh','reactiveBilledOffPeakKwh'];
const canonical=(value:string)=>{const [whole,fraction='']=value.split('.');return whole.replace(/^0+(?=\d)/,'')+'.'+fraction.replace(/0+$/,'');};
/** Only fill omissions. An OCR proposal never replaces an operator's saved value. */
export function prefillMeasurements<T extends Record<string,string|null>>(current:T,proposal:OcrAutofill|undefined){
 const measurements={...current};const filled:string[]=[],conflicts:string[]=[];
 for(const key of keys){const value=proposal?.measurements[key];if(value==null||!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))continue;
  if(key==='demandSingle'&&(current.demandPeak!=null||current.demandOffPeak!=null)||['demandPeak','demandOffPeak'].includes(key)&&current.demandSingle!=null||key==='reactiveTotal'&&(current.reactiveBilledPeakKwh!=null||current.reactiveBilledOffPeakKwh!=null)||key.startsWith('reactiveBilled')&&current.reactiveTotal!=null)continue;
  if(current[key]==null||current[key]===''){(measurements as Record<string,string|null>)[key]=value;filled.push(key);}
  else if(canonical(current[key]!)!==canonical(value))conflicts.push(key);
 }
 return {measurements,filled,conflicts};
}
export function ocrReviewNote(notes:string,proposal:OcrAutofill){
 const result=[notes.trim(),'Bot-Energy · OK do operador: preenchimentos e fontes conferidos · '+proposal.source+' · validação e publicação permanecem separadas.'].filter(Boolean).join('\n');
 if(result.length>2000)throw Error('As observações excedem o limite. Revise o texto antes de salvar; a conferência não será cortada.');
 return result;
}
export function sameInvoiceCost(existing:{scenario:string;category:string;label:string;source:string},candidate:{scenario:string;category:string;label:string;source:string}){
 if(existing.scenario!==candidate.scenario)return false;
 const cip=(label:string)=>/\bCIP\b|ILUMINACAO PUBLICA/.test(label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase());
 // One monthly CIP component; differing labels or provenance suffixes must not add it twice.
 if(cip(candidate.label))return cip(existing.label)&&['OTHER','CHARGE'].includes(existing.category)&&['OTHER','CHARGE'].includes(candidate.category);
 return existing.category===candidate.category&&(existing.label===candidate.label||existing.source===candidate.source);
}
