import {AiEvidence} from './azure-backoffice-ai.connector';
export const questionText=(s:string)=>s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export function questionMonths(question:string):string[] {
 const text=questionText(question),matches=new Set<string>();
 for(const m of text.matchAll(/\b((?:20|21)\d{2})-(0[1-9]|1[0-2])\b/g))matches.add(m[1]+'-'+m[2]);
 for(const m of text.matchAll(/\b(0?[1-9]|1[0-2])\/((?:20|21)\d{2})\b/g))matches.add(m[2]+'-'+m[1].padStart(2,'0'));
 const names=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
 for(const m of text.matchAll(new RegExp('\\b('+names.join('|')+')(?:\\s+de)?\\s+((?:20|21)\\d{2})\\b','g')))matches.add(m[2]+'-'+String(names.indexOf(m[1])+1).padStart(2,'0'));
 return [...matches];
}
export function questionMonth(question:string):string|null {const matches=questionMonths(question);return matches.length===1?matches[0]:null;}
export function questionIntent(question:string){const q=questionText(question);return /economia|economizou|economiz|resultado|custo total/.test(q)?'economy':/fornecedor|contratual|preco.*energia/.test(q)?'supplier':/desperdicio|perda|ineficien/.test(q)?'waste':/demanda/.test(q)?'demand':/\bgd\b|geracao distribuida/.test(q)?'regulation':/tusd|tarifa/.test(q)?'tariff':'general';}

/** Select evidence for this question, without deriving totals or changing source values. */
export function questionEvidence(question:string,evidence:AiEvidence[]):AiEvidence[]{
 const intent=questionIntent(question),words=questionText(question).split(/[^a-z0-9]+/).filter(w=>w.length>3);
 const score=(e:AiEvidence)=>{
  if(['context','library-availability','financial-coverage'].includes(e.id))return 100;
  if(intent==='supplier'&&e.id.startsWith('supplier-'))return 90;
  if(intent==='economy'&&e.id.startsWith('published-unit-'))return 90;
  if(intent==='regulation'&&e.id.startsWith('regulation-'))return 90;
  return words.filter(w=>questionText(e.label+' '+e.value).includes(w)).length*5;
 };
 const ordered=evidence.map((e,i)=>({e,i,s:score(e)})).sort((a,b)=>b.s-a.s||a.i-b.i),out:AiEvidence[]=[];let size=Buffer.byteLength(JSON.stringify({question,evidence:[]}));
 for(const {e} of ordered){const bytes=Buffer.byteLength(JSON.stringify(e))+1;if(size+bytes>42000||out.length>=140)continue;out.push(e);size+=bytes;}
 if(out.length<evidence.length)out.push({id:'selected-context',label:'Recorte das evidências',value:'Foram selecionadas fontes pertinentes à pergunta. Este recorte não é uma auditoria completa; não extrapolar totais nem concluir ausência de desperdício.',source:'Seleção por relevância no backend'});
 return out;
}
