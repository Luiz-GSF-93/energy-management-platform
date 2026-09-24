'use client';
import {useState} from 'react';
import {Alert,Button} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
export const notificationMessage=(status?:string)=>status==='accepted'?'Aviso encaminhado ao serviço de e-mail. O usuário pode entrar com seu login atual.':status==='unavailable'?'Vínculo salvo. O envio do aviso ainda não está configurado.':'Vínculo salvo, mas o envio do aviso não foi confirmado. Use Enviar aviso do vínculo para tentar novamente.';
export default function NotificationAction({userId,disabled}:{userId:string;disabled:boolean}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function send(){if(busy)return;setBusy(true);setMessage('');try{const r=await apiRequest<{notificationStatus:string}>(`/api/v1/admin/users/${encodeURIComponent(userId)}/notification`,{method:'POST'});setMessage(notificationMessage(r.notificationStatus));}catch(e){setMessage(e instanceof Error?e.message:'Não foi possível enviar o aviso.');}finally{setBusy(false);}}
 return <div><Button variant="secondary" disabled={disabled||busy} onClick={send}>{busy?'Enviando aviso...':'Enviar aviso do vínculo'}</Button>{message?<Alert>{message}</Alert>:null}</div>;
}
