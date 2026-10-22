'use client';
import {useId,useRef,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from './ui';
export type WasteDeclaration={publicationId:string;unitId:string;sourceHash:string;key:string;month:string;amount:string;label:string;corrected:boolean;revision:number;actorId:string;declaredAt:string};
type Target=Pick<WasteDeclaration,'publicationId'|'unitId'|'sourceHash'|'key'|'month'>;
export default function PortalWasteCorrection({target,declaration,onSaved}:{target:Target;declaration?:WasteDeclaration;onSaved:()=>void}){
 const id=useId(),pending=useRef<(Target&{corrected:boolean;revision:number;requestId:string})|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(corrected:boolean){if(busy)return;if(!pending.current)pending.current={...target,corrected,revision:declaration?.revision??0,requestId:crypto.randomUUID()};setBusy(true);setError('');try{await apiRequest('/api/v1/portal/financial-details/corrections',{method:'POST',body:pending.current});pending.current=null;onSaved();}catch(e){setError(e instanceof Error?e.message:'Registro não confirmado.');}finally{setBusy(false);}}
 return <div><fieldset disabled={busy||pending.current!==null}><legend>Corrigido?</legend><label><input type="radio" name={id} checked={declaration?.corrected===true} onChange={()=>void save(true)}/> Sim</label>{' '}<label><input type="radio" name={id} checked={declaration?.corrected!==true} onChange={()=>void save(false)}/> Não</label></fieldset>{declaration?<small>Declarado em {new Date(declaration.declaredAt).toLocaleString('pt-BR')} · revisão {declaration.revision}. Responsável: {declaration.actorId}.</small>:null}{error?<Alert variant="error">{error}{pending.current?<Button variant="secondary" disabled={busy} onClick={()=>void save(pending.current!.corrected)}>Confirmar o mesmo registro pendente</Button>:null}</Alert>:null}</div>;
}
