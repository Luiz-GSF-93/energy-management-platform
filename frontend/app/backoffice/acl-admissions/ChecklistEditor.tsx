'use client';
import {useState} from 'react';
export type ChecklistItem={key:string;label:string;optional:boolean};
export type ChecklistCatalog={version:string;stages:Record<string,Record<string,ChecklistItem[]>>};
export type Checklist={templateVersion:string;reference:string;referenceDate:string;deadlineDate?:string;items:Record<string,{status:string;note:string;documentId:string}>};
export function checklistReady(v:Checklist|null,spec:ChecklistItem[]|undefined,ids:string[],version?:string){
 if(!spec)return true;
 const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 return !!v&&v.templateVersion===version&&v.reference.trim().length>=20&&v.reference.length<=300&&date(v.referenceDate)&&(!v.deadlineDate||date(v.deadlineDate))&&Object.keys(v.items).length===spec.length&&spec.every(i=>{const a=v.items[i.key];return a&&['CONFIRMED',...(i.optional?['NOT_APPLICABLE']:[])].includes(a.status)&&a.note.trim().length>=10&&a.note.length<=500&&ids.includes(a.documentId);});
}
export default function ChecklistEditor({spec,version,documentIds,sources,onChange,disabled}:{spec:ChecklistItem[];version:string;documentIds:string[];sources:{id:string;name:string}[];onChange:(v:Checklist)=>void;disabled:boolean}){
 const [v,setV]=useState<Checklist>({templateVersion:version,reference:'',referenceDate:'',items:Object.fromEntries(spec.map(i=>[i.key,{status:'',note:'',documentId:''}]))});
 function change(next:Checklist){setV(next);onChange(next);}
 return <fieldset disabled={disabled} aria-label="Checklist da etapa"><legend>Checklist da etapa · {version}</legend>
 <p>Conferência operacional do Consultor. Informe a referência e sua vigência, selecione a fonte de cada item e justifique a conclusão. Um item pendente impede o registro para revisão.</p>
 <label htmlFor="acl-check-reference">Referência usada: contrato, procedimento ou estudo</label><textarea id="acl-check-reference" maxLength={300} value={v.reference} onChange={e=>change({...v,reference:e.target.value})}/>
 <label htmlFor="acl-check-date">Data ou vigência da referência</label><input id="acl-check-date" type="date" value={v.referenceDate} onChange={e=>change({...v,referenceDate:e.target.value})}/>
 <label htmlFor="acl-check-deadline">Prazo conferido na referência (opcional)</label><input id="acl-check-deadline" type="date" value={v.deadlineDate||''} onChange={e=>{const next={...v};if(e.target.value)next.deadlineDate=e.target.value;else delete next.deadlineDate;change(next);}}/>
 <p>O prazo registrado aqui não cria uma tarefa. Use Solicitações e Agenda para acompanhar vencimentos.</p>
 {spec.map(i=><fieldset key={i.key}><legend>{i.label}</legend>
 <label htmlFor={'acl-check-status-'+i.key}>Situação</label><select id={'acl-check-status-'+i.key} value={v.items[i.key].status} onChange={e=>change({...v,items:{...v.items,[i.key]:{...v.items[i.key],status:e.target.value}}})}><option value="">Pendente de conferência</option><option value="CONFIRMED">Conferido</option>{i.optional?<option value="NOT_APPLICABLE">Não aplicável, com justificativa</option>:null}</select>
 <label htmlFor={'acl-check-doc-'+i.key}>Documento de origem</label><select id={'acl-check-doc-'+i.key} value={v.items[i.key].documentId} onChange={e=>change({...v,items:{...v.items,[i.key]:{...v.items[i.key],documentId:e.target.value}}})}><option value="">Selecione um documento marcado acima</option>{documentIds.map(id=><option key={id} value={id}>{sources.find(s=>s.id===id)?.name||id}</option>)}</select>
 <label htmlFor={'acl-check-note-'+i.key}>Conferência ou motivo da não aplicabilidade</label><textarea id={'acl-check-note-'+i.key} maxLength={500} value={v.items[i.key].note} onChange={e=>change({...v,items:{...v.items,[i.key]:{...v.items[i.key],note:e.target.value}}})}/>
 </fieldset>)}
 <p>Este checklist não comprova assinatura digital, aprovação pela CCEE ou início do suprimento.</p>
 </fieldset>;
}
