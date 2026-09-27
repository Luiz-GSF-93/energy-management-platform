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
