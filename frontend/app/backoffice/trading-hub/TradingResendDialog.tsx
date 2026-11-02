'use client';
import {FormEvent,useEffect,useRef,useState} from 'react';
import {Alert,Button} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import styles from './trading.module.css';
export type TradingInvitation={id:string;email:string;state:string;kind:string;opportunity_id:string;email_status:string;email_revision:number;email_attempt_at:string|null;email_http_status:number|null;email_error_code:string|null;expires_at:string};
export function mailStatus(i:Pick<TradingInvitation,'email_status'|'email_error_code'|'email_http_status'>){
 if(i.email_error_code==='SENDER_DOMAIN_NOT_ALLOWED')return 'Recusado: chave sem autorização para o domínio de cotações (403).';
 return ({ACCEPTED:'Aceito pelo provedor; recebimento ainda não comprovado',REJECTED:'Recusado pelo provedor'+(i.email_http_status?' (HTTP '+i.email_http_status+')':''),NOT_CONFIGURED:'Configure a chave exclusiva de cotações',SENDING:'Reenvio solicitado; aguardando resultado',UNKNOWN:'Resultado não confirmado; confira o provedor antes de reenviar',PENDING:'Aguardando envio'} as Record<string,string>)[i.email_status]||'Resultado não confirmado';
}
export function canResend(i:TradingInvitation,now=Date.now()){
 return Number.isInteger(i.email_revision)&&i.email_revision>=0&&i.state==='PENDING'&&Date.parse(i.expires_at)>now&&!(i.email_attempt_at&&Date.parse(i.email_attempt_at)>now-(i.email_status==='SENDING'?120000:60000));
}
export default function TradingResendDialog({invitation,title,onClose,onDone}:{invitation:TradingInvitation;title:string;onClose:()=>void;onDone:(message:string)=>Promise<void>}){
 const ref=useRef<HTMLDialogElement>(null),lock=useRef(false),attempt=useRef<{key:string;id:string}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>{if(!ref.current?.open)ref.current?.showModal();},[]);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(lock.current||!confirmed||reason.trim().length<3)return;lock.current=true;setBusy(true);setError('');
  const body={revision:invitation.email_revision,reason:reason.trim()},key=JSON.stringify(body);if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
  try{const r=await apiRequest<{state:string;httpStatus?:number;code?:string;replayed?:boolean}>('/api/v1/trading-hub/invitations/'+invitation.id+'/resend',{method:'POST',body:{...body,requestId:attempt.current.id}});
   const message=mailStatus({email_status:r.state,email_error_code:r.code??null,email_http_status:r.httpStatus??null});
   await onDone((r.replayed?'Requisição já registrada; nenhum novo envio foi feito. ':'')+message);onClose();
  }catch(e){setError((e instanceof Error?e.message:'Resultado não confirmado.')+' Consulte o acompanhamento antes de repetir.');}finally{lock.current=false;setBusy(false);}
 }
 return <dialog ref={ref} className={styles.dialog} aria-labelledby="trading-resend-title" onCancel={e=>{if(busy)e.preventDefault();}} onClose={onClose}><div className={styles.header}><h2 id="trading-resend-title">Reenviar convite</h2><Button variant="secondary" disabled={busy} onClick={onClose}>Fechar</Button></div>{error?<Alert variant="error">{error}</Alert>:null}<p><strong>Cotação:</strong> {title}</p><p><strong>Destinatário:</strong> {invitation.email}</p><p><strong>Prazo preservado:</strong> {new Date(invitation.expires_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} (Brasília)</p><p>{mailStatus(invitation)}</p><p>Ao confirmar, o link e os códigos anteriores deixarão de funcionar. Um novo convite será enviado ao mesmo e-mail. Esta ação não altera o prazo nem o destinatário.</p><form onSubmit={submit}><label>Motivo do reenvio *<textarea className="ds-input" required minLength={3} maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><label style={{display:'block',margin:'16px 0'}}><input type="checkbox" required disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Conferi destinatário, prazo e histórico do provedor e autorizo um novo convite, invalidando o link anterior.</label><Button type="submit" disabled={busy||!confirmed||reason.trim().length<3}>{busy?'Registrando reenvio…':'Confirmar e reenviar convite'}</Button></form></dialog>;
}
