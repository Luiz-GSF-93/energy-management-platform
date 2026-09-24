 'use client';
import {useState} from 'react';
import {Alert,Button} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
export default function StatusAction({userId,email,status,disabled,onChanged}:{userId:string;email:string;status:string;disabled:boolean;onChanged:(notificationStatus?:string)=>Promise<void>}) {
 const [confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const activating=status==='inactive',label=activating?'Reativar nesta organização':'Desativar nesta organização';
 async function change(){if(busy)return;setBusy(true);setError('');
  try{const result=await apiRequest<{notificationStatus?:string}>('/api/v1/admin/users/'+encodeURIComponent(userId)+'/status',{method:'PATCH',body:{status:activating?'active':'inactive'}});setConfirming(false);await onChanged(result.notificationStatus);}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível alterar o acesso.');}finally{setBusy(false);}}
 return <div>{error&&<Alert variant="error">{error}</Alert>}{confirming?<fieldset disabled={busy||disabled} className="organizations-create__form"><legend>{label}</legend>
 <p>Confirmar esta ação para <strong>{email}</strong>?</p>
 <p>{activating?'O usuário voltará a acessar esta organização com sua função atual, respeitando o limite de usuários da licença. Ele receberá um aviso por e-mail.':'O usuário perderá o acesso a esta organização. Os documentos, o histórico e os vínculos em outras organizações serão preservados.'}</p>
 <Button type="button" disabled={busy||disabled} onClick={change}>{busy?'Salvando...':'Confirmar'}</Button>
 <Button type="button" variant="secondary" disabled={busy} onClick={()=>{setConfirming(false);setError('');}}>Cancelar</Button>
 </fieldset>:<Button type="button" variant="secondary" disabled={busy||disabled} onClick={()=>{setConfirming(true);setError('');}}>{label}</Button>}</div>;
}
