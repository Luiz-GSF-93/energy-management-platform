import type {CpflOperation} from '../ocr/cpfl-paulista-layout';
import {supplierProposal} from './acl-supplier-preview';
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
/** Source-backed suggestions only. No inferred tariff or inherited customer rate. */
export function invoiceTariffDraft(layout:{layoutId:string|null;operations:CpflOperation[]},documentId:string,month:string|null){
 const pending:string[]=[],proof:{field:string;documentId:string;month:string|null;source:string;pages:number[];value:string}[]=[];
 const values={peakBrlKwh:'',offPeakBrlKwh:'',demandBrlKw:''};
 const labels={peakBrlKwh:'TUSD ponta',offPeakBrlKwh:'TUSD fora de ponta',demandBrlKw:'TUSD demanda'};
 const valid=(r:CpflOperation,k:string)=>{const f=r.fields[k];return !!f&&!!f.spans.length&&!!f.pages.length&&!f.issues.some(i=>!['MISSING_CONFIDENCE','CONFIDENCE_REQUIRES_REVIEW'].includes(i));};
 const positive=(s:string|null|undefined)=>!!s&&/^(0|[1-9][0-9]{0,8})(\.[0-9]{1,9})?$/.test(s)&&Number(s)>0;
 if(layout.layoutId!=='cpfl-paulista-a'||!month)return {values,proof,pending:['Tarifas automáticas exigem layout CPFL Grupo A e competência identificados.']};
 const off=(r:CpflOperation)=>/\b(?:FPONTA|F PONTA|FORA PONTA|FORA DE PONTA)\b/.test(norm(r.fields.description?.text??''));
 const demand=layout.operations.filter(r=>r.component==='DEMAND_BILLED'&&r.fields.unit?.text.toLowerCase()==='kw');
 // Different taxed and untaxed demand rows must never be collapsed or selected by amount.
 const taxed=demand.filter(r=>valid(r,'icmsBase')&&valid(r,'icmsRate')&&positive(r.fields.icmsRate.decimal)&&r.fields.icmsBase.decimal===r.fields.amount?.decimal);
 const tariffRows=layout.operations.filter(r=>!(r.fields.amount?.decimal?.startsWith('-')&&/^ENERGIA (?:ATV|ATIVA) (?:INJ|INJETADA)\b/.test(norm(r.fields.description?.text??''))));
 const candidates={peakBrlKwh:tariffRows.filter(r=>r.component==='TUSD_ENERGY'&&!off(r)&&/\bPONTA\b/.test(norm(r.fields.description?.text??''))),offPeakBrlKwh:tariffRows.filter(r=>r.component==='TUSD_ENERGY'&&off(r)),demandBrlKw:demand.length===1?demand:taxed};
 for(const key of Object.keys(values) as (keyof typeof values)[]){const rows=candidates[key],row=rows[0];
  if(rows.length!==1||!row||row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN','QUANTITY_TARIFF_AMOUNT_DIVERGENCE'].includes(i))||!['description','grossRate','unit','quantity','amount'].every(k=>valid(row,k))||!positive(row.fields.grossRate.decimal)||!positive(row.fields.amount.decimal)||!positive(row.fields.quantity.decimal)||row.fields.unit.text.toLowerCase()!==(key==='demandBrlKw'?'kw':'kwh')||row.arithmetic.state!=='MATCH_WITHIN_ONE_CENT'){pending.push('Tarifa '+labels[key]+' ausente, ambígua ou sem conciliação; conferir na fatura.');continue;}
  if(['description','grossRate','unit','quantity','amount'].some(k=>row.fields[k].issues.length))pending.push('Tarifa '+labels[key]+' sugerida pela fonte OCR; confiança requer conferência do Consultor.');
  values[key]=row.fields.grossRate.decimal!;proof.push({field:key,documentId,month,source:row.source,pages:row.fields.grossRate.pages,value:values[key]});
 }
 return {values,proof,pending};
}
/** An immutable study is a reusable simulation model, never a new contractual proposal. */
export function scenarioDraft(study:any,tariffs:ReturnType<typeof invoiceTariffDraft>|null,documentId:string,referenceMonth:string|null){
 if(!study||study.review?.decision==='REJECTED')throw Error('Selecione uma versão de estudo disponível e não rejeitada.');
 const model=supplierProposal(study.body?.result?.proposal);
 const source='Modelo de simulação: estudo '+study.id+', versão '+study.version+'. Conferir preço, vigência, tributos e condições para esta unidade.';
 const {financialBasis:ignoredFinancialBasis,...reusable}=model;
 const proposal={...reusable,checked:false,startMonth:model.startMonth,source,distribution:model.distribution?{...model.distribution,...(tariffs?.values??{peakBrlKwh:'',offPeakBrlKwh:'',demandBrlKw:''}),checked:false,source:'Tarifas com tributos da fatura atual '+documentId+', competência '+(referenceMonth??'pendente')+'. Demanda medida como estimativa; conferir enquadramento e desconto.'}:null,...(model.energyBasis?{energyBasis:{...model.energyBasis,checked:false}}:{}),...(model.costPremises?{costPremises:{...model.costPremises,checked:false,source:'Premissas estimadas herdadas do estudo '+study.id+', versão '+study.version+'. Conferir contribuição, encargos, investimento e hipótese GD nesta unidade.'}}:{})};
 return {schemaVersion:'acl-scenario-draft/1',reviewRequired:true,template:{studyId:study.id,version:study.version,hash:study.hash,review:study.review?.decision??'PENDING'},proposal,tariffProof:tariffs?.proof??[],pending:[...(tariffs?.pending??['Leitura das tarifas atuais indisponível.']),...(study.review?.decision==='REVIEWED'?[]:['O modelo ainda aguarda revisão independente das premissas.']),'Vigência herdada do modelo; confirmar início e validade da proposta para esta unidade.','Preço, perdas, ICMS, desconto e custos herdados são premissas de simulação sujeitas à conferência; não comprovam condições comerciais atuais.','Histórico e créditos são os da unidade atual; nenhum consumo ou tarifa do modelo é copiado.']};
}
