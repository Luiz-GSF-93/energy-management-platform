export type Choice = '' | 'YES' | 'NO';
export type IncidenceItem = {component:string;incidence:Choice;exclusion:Choice;reason:string};
export type IncidenceRule = {tax:string;items:IncidenceItem[];notes:string};
const prefix='EE_TAX_INCIDENCE_V1\n';
const yes=(component:string,reason:string):IncidenceItem=>({component,incidence:'YES',exclusion:'NO',reason});
const no=(component:string,reason:string):IncidenceItem=>({component,incidence:'NO',exclusion:'YES',reason});
export function taxTemplate(tax:string):IncidenceItem[]{
 if(tax==='ICMS')return [yes('Energia Ativa','Consumo efetivo'),yes('Demanda Utilizada','Disponibilização do serviço'),no('Demanda Não Utilizada','Jurisprudência aplicável — identificar fundamento e período'),no('Multa por Atraso','Natureza não mercantil'),no('Juros','Acréscimo financeiro'),{component:'TUSD',incidence:'',exclusion:'',reason:'Revisar Tema 986/STJ e eventual decisão judicial aplicável à unidade e ao período'}];
 if(tax==='PIS'||tax==='COFINS')return [yes('Receita tributável','Receita sujeita ao tributo — conferir regime e período'),no('ICMS destacado','Tema 69/STF — confirmar aplicação ao caso'),no('Receitas isentas','Informar fundamento específico da isenção')];
 if(tax==='IOF')return [yes('Valor da operação financeira','Legislação federal — identificar modalidade e fundamento'),no('Operações isentas','Informar fundamento específico da isenção'),{component:'Operações com alíquota zero',incidence:'',exclusion:'',reason:'Alíquota zero não equivale automaticamente a exclusão da base; identificar regra da operação'}];
 return [];
}
export function encodeIncidence(rule:IncidenceRule){return prefix+JSON.stringify(rule);}
export function decodeIncidence(value:string):IncidenceRule|null{
 if(!value.startsWith(prefix))return null;
 try{const r=JSON.parse(value.slice(prefix.length));if(!r||typeof r.tax!=='string'||typeof r.notes!=='string'||!Array.isArray(r.items)||!r.items.every((i:IncidenceItem)=>i&&typeof i.component==='string'&&typeof i.reason==='string'&&['','YES','NO'].includes(i.incidence)&&['','YES','NO'].includes(i.exclusion)))return null;return r;}catch{return null;}
}
export function incidenceProblem(value:string,tax:string):string|null{
 const r=decodeIncidence(value);if(!r)return null;
 if(r.tax!==tax)return 'Revise o modelo: o tributo foi alterado. Use o modelo do tributo selecionado.';
 if(r.items.some(i=>!i.component.trim()||!i.reason.trim()||!i.incidence||!i.exclusion))return 'Preencha os componentes, as opções Sim/Não e as justificativas da base tributária.';
 if(r.items.some(i=>i.incidence==='YES'&&i.exclusion==='YES'))return 'Um componente não pode integrar a base e ser excluído ao mesmo tempo.';
 if(!r.items.length&&!r.notes.trim())return 'Informe os componentes ou a justificativa da base tributária.';
 if(value.length>4096)return 'A base tributária ultrapassou 4096 caracteres. Reduza as justificativas.';
 return null;
}
export function incidenceText(value:string){const r=decodeIncidence(value);if(!r)return value;const choice=(v:Choice)=>v==='YES'?'Sim':v==='NO'?'Não':'A definir';return [r.tax,...r.items.map(i=>i.component+' | Base de incidência: '+choice(i.incidence)+' | Exclusão: '+choice(i.exclusion)+' | Justificativa: '+i.reason),r.notes].filter(Boolean).join('\n');}
