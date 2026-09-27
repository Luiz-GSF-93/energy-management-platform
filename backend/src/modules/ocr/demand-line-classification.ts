import type {CpflOperation} from './cpfl-paulista-layout';
/** Description evidence only. Never infer usage from tax, row order or rounded meter readings. */
export function demandLineClassification(row:CpflOperation){
 const pending=(message:string)=>({kind:'UNCLASSIFIED',basis:'DESCRIPTION',message});
 const field=row.fields.description;
 if(!field?.text?.trim()||field.issues.length||row.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i)))return pending('Descrição ausente ou com evidência ambígua; conferir no PDF.');
 const text=field.text.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
 // Restrict recognition to literal phrases; negation and mixed labels remain unresolved.
 const unused=/\bDEMANDA NAO UTILIZADA\b/.test(text);
 const used=/\bDEMANDA UTILIZADA\b/.test(text);
 if(unused&&used)return pending('A descrição menciona demanda utilizada e não utilizada; conferir a parcela.');
 if(/\bNAO DEMANDA UTILIZADA\b|\bSEM DEMANDA UTILIZADA\b/.test(text))return pending('Descrição com negação; conferir o significado da parcela.');
 if(unused)return {kind:'UNUSED_EXPLICIT',basis:'DESCRIPTION',message:'A descrição identifica demanda não utilizada. A quantidade é a faturada nesta linha, não uma medição reconstruída.'};
 if(used)return {kind:'USED_EXPLICIT',basis:'DESCRIPTION',message:'A descrição identifica demanda utilizada. A quantidade é a faturada nesta linha, não substitui a medição do equipamento.'};
 return pending('A descrição não identifica uso da demanda. Contrato, valor e tributação não determinam essa classificação.');
}

/** Tax pattern is a review signal, not proof of usage or a tax-incidence rule. */
export function demandTaxEvidence(row:CpflOperation,rows:CpflOperation[]){
 const keys=['icmsAmount','pisAmount','cofinsAmount'];
 const values=(r:CpflOperation)=>keys.map(k=>r.fields[k]);
 const eligible=(r:CpflOperation)=>r.component==='DEMAND_BILLED'&&r.role==='CHARGE'&&r.fields.unit?.text.trim().toLowerCase()==='kw'&&!r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i));
 const verified=(r:CpflOperation)=>eligible(r)&&values(r).every(f=>f&&f.text.trim()&&typeof f.decimal==='string'&&/^[0-9]+(?:[.][0-9]+)?$/.test(f.decimal)&&f.issues.length===0);
 const zero=(s:string)=>/^0+(?:[.]0+)?$/.test(s);
 if(!verified(row)||!zero(row.fields.icmsAmount.decimal!)||zero(row.fields.pisAmount.decimal!)||zero(row.fields.cofinsAmount.decimal!))return null;
 const taxed=rows.filter(r=>r.source!==row.source&&verified(r)&&values(r).every(f=>!zero(f.decimal!)));
 if(taxed.length!==1)return null;
 return {kind:'UNUSED_TAX_REVIEW',basis:'ZERO_ICMS_WITH_PIS_COFINS',message:'Candidata a demanda não utilizada: ICMS aparece explicitamente zerado nesta linha, com PIS e Cofins positivos, e há outra parcela de demanda com ICMS positivo. Confirme o enquadramento no PDF; campo não lido não equivale a imposto zero.'};
}
