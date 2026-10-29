'use client';
import EvaProcessingStatus from '../../components/EvaProcessingStatus';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button} from '@/app/components/ui';
import WorkflowModal from './WorkflowModal';
import {PERM} from './types';

const signedAmount=(i:any)=>i.effect==='CREDIT'&&Number(i.amount)!==0?'-'+i.amount:i.amount;
const parsedAmount=(value:string)=>{
 const normalized=value.trim().replace(',','.');
 if(!/^-?\d{1,12}(\.\d{1,2})?$/.test(normalized))return null;
 const negative=normalized.startsWith('-')&&Number(normalized)!==0;
 return {effect:negative?'CREDIT':'COST',amount:Math.abs(Number(normalized)).toFixed(2)};
};

export default function CceeCostReview({unit,month,closingId,closingHash,customerId,organizationId,onClose,onValidated}:{unit:any;month:string;closingId:string;closingHash:string;customerId:string;organizationId:string;onClose:()=>void;onValidated:()=>Promise<void>}){
 const {hasPermission}=useAuth(),[base,setBase]=useState<any>(null),[loaded,setLoaded]=useState(false),[canValidate,setCanValidate]=useState(false),[items,setItems]=useState<any[]>(()=>unit.prepared.ccee.items.map((i:any)=>({...i,id:crypto.randomUUID(),amount:signedAmount(i)}))),[ack,setAck]=useState(false),[note,setNote]=useState('Estimativa histórica CCEE conferida para esta unidade e competência.'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState<any>(null),[done,setDone]=useState(false);
 const live=useRef(true),working=useRef(false),query=new URLSearchParams({consumerUnitId:unit.id,month}).toString();
 const scoped=(r:any)=>r.organization_id===organizationId&&r.customer_id===customerId&&r.consumer_unit_id===unit.id&&r.month===month;
 const fingerprint=(r:any)=>JSON.stringify(r?[r.id,r.revision,r.status,r.costs]:null);
 useEffect(()=>{live.current=true;apiRequest<any>('/api/v1/calculation-monthly-costs?'+query).then(d=>{if(!live.current)return;if(!Array.isArray(d.rows)||!d.rows.every(scoped))throw Error('Custos fora da unidade e competência.');const b=d.rows[0]??null;if(b?.costs?.items?.some((i:any)=>i.category==='CCEE'&&i.scenario==='ACL'))throw Error('Já existem custos CCEE nesta competência. Atualize as fontes pela EVA antes de conferir.');if(b?.costs?.noCosts)throw Error('Existe declaração de ausência de custos. Revise o registro antes de continuar.');setBase(b);setCanValidate(d.canValidate===true);setLoaded(true);}).catch(e=>{if(live.current)setError(e.message)});return()=>{live.current=false;};},[query]);
 const writable=loaded&&canValidate&&hasPermission?.(base?.status==='DRAFT'?PERM.update:PERM.create)&&hasPermission?.(PERM.update);
 async function validate(){
  if(working.current||uncertain||done||!writable||!ack||note.trim().length<20)return;
  if(items.some(i=>!parsedAmount(i.amount))){setError('Informe custos positivos ou créditos negativos com até duas casas decimais, sem separador de milhar.');return;}
  working.current=true;setBusy(true);setError('');let sent=false;
  try{
   const h=await apiRequest<any>('/api/v1/eva-assisted-closing?'+query+'&page=0');
   const current=h.rows?.[0];if(current?.id!==closingId||current.payload_hash!==closingHash||current.report?.organizationId!==organizationId||current.customer_id!==customerId||current.month!==month||!current.report?.unitIds?.includes(unit.id)||['APPROVED','REJECTED','SUPERSEDED'].includes(current.state))throw Error('A preparação mudou. Feche a conferência e atualize o histórico.');
   let row=saved;
   if(!row){
    const d=await apiRequest<any>('/api/v1/calculation-monthly-costs?'+query);if(!Array.isArray(d.rows)||!d.rows.every(scoped)||!d.canValidate||fingerprint(d.rows[0]??null)!==fingerprint(base))throw Error('Os custos mudaram. Feche e abra novamente a conferência.');
    const reference='ESTIMATIVA CCEE revisada · EVA '+closingId+' · '+closingHash;
    const costs={noCosts:false,items:[...(base?.costs?.items??[]),...items.map(i=>({id:i.id,label:('Estimativa CCEE revisada · '+i.label).slice(0,200),category:'CCEE',scenario:'ACL',...parsedAmount(i.amount)!,source:(reference+' · fontes: '+i.sources.map((s:any)=>s.month+' v'+s.version+' '+s.settlementId+' peso '+s.weight).join('; ')).slice(0,1000),taxTreatment:'INCLUDED'}))]};
    sent=true;row=await apiRequest<any>('/api/v1/calculation-monthly-costs'+(base?.status==='DRAFT'?'/'+base.id:''),{method:base?.status==='DRAFT'?'PUT':'POST',body:{consumerUnitId:unit.id,month,costs,sourceReference:((base?.source_reference?base.source_reference+'; ':'')+reference).slice(0,2000),notes:((base?.notes?base.notes+'\n':'')+'Estimativa histórica aceita para esta apuração. '+note.trim()).slice(0,2000),correctionReason:note.trim(),previousId:base?.status==='DRAFT'?base.previous_id??null:base?.id??null,...(base?.status==='DRAFT'?{revision:base.revision}:{})}});
    if(!scoped(row)||row.status!=='DRAFT')throw Error('Gravação não confirmada. Consulte o histórico de custos antes de repetir.');
    if(live.current)setSaved(row);
   }
   sent=true;const validated=await apiRequest<any>('/api/v1/calculation-monthly-costs/'+row.id+'/validate',{method:'POST',body:{revision:row.revision}});
   if(!scoped(validated)||validated.status!=='VALIDATED')throw Error('Validação não confirmada. Consulte o histórico de custos.');
   if(live.current)setDone(true);
   await onValidated();
  }catch(e){if(live.current){setError(e instanceof Error?e.message:'Não foi possível confirmar a conferência.');if(sent)setUncertain(true);}}
  finally{working.current=false;if(live.current)setBusy(false);}
 }
 const total=items.reduce((sum,i)=>sum+(Number(i.amount.trim().replace(',','.'))||0),0);
 return <WorkflowModal title='Conferência dos custos CCEE' onClose={()=>{if(!working.current)onClose();}}>{busy?<EvaProcessingStatus floating detail='Validando os custos CCEE e reconferindo a apuração…'/>:null}<p><strong>{unit.name} · {month}</strong></p><p>Valores preenchidos pela EVA a partir do histórico. Ajuste se necessário e valide esta estimativa para a apuração. A origem estimada permanece registrada; não comprova pagamento nem recebimento pela API.</p>{error?<Alert variant='error'>{error}</Alert>:null}
 <fieldset disabled={!writable||busy||uncertain||done||!!saved}><legend>Custos CCEE preenchidos pela EVA</legend><p>Informe custos com valor positivo e créditos com sinal negativo. O crédito será deduzido uma única vez do total CCEE.</p>{items.map((i,index)=><div key={i.id}><label>{i.label} · {parsedAmount(i.amount)?.effect==='CREDIT'?'Crédito':'Custo'} (R$)<input className='ds-input' inputMode='decimal' value={i.amount} onChange={e=>{setItems(old=>old.map((r,n)=>n===index?{...r,amount:e.target.value}:r));setAck(false);}}/></label><details><summary>Memória de cálculo e fontes</summary><ul>{i.sources.map((s:any)=><li key={s.month+s.settlementId}>{s.month}: R$ {s.amount} × peso {s.weight} · fechamento v{s.version} · {s.settlementId}</li>)}</ul></details></div>)}<p>Total CCEE: <strong>{total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong></p><label>Observação da conferência<textarea className='ds-input' maxLength={1200} value={note} onChange={e=>setNote(e.target.value)}/></label><label><input type='checkbox' checked={ack} onChange={e=>setAck(e.target.checked)}/>Conferi os valores estimados desta competência e os aceito como valores finais para esta apuração, sem acrescentar tributos. A estimativa permanece identificada e os demais lançamentos são preservados.</label></fieldset>
 {!loaded&&!error?<p role='status'>Conferindo registros da competência…</p>:null}{loaded&&!writable?<p>A validação exige permissão para registrar custos e perfil Gestor ou Administrador.</p>:null}
 {done?<p role='status'>Custos CCEE validados. Confira a nova versão preparada pela EVA antes da aprovação do fechamento.</p>:<Button disabled={!writable||busy||uncertain||!ack||note.trim().length<20} onClick={()=>void validate()}>{busy?'Validando custos CCEE…':'Validar custos CCEE e reconferir pela EVA'}</Button>}
 {uncertain?<p>Não reenvie. Consulte o histórico em Custos mensais para confirmar a gravação e a validação antes de abrir outra conferência.</p>:null}<p>Esta ação valida os custos mensais; a aprovação e a publicação do fechamento continuam separadas.</p></WorkflowModal>;
}
