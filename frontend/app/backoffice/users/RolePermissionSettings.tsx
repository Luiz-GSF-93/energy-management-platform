'use client';
import {FormEvent,useCallback,useRef,useState} from 'react';
import {Alert,Button} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import CustomerSelector from '../contracts/CustomerSelector';
import PermissionOptions,{permissionSelectionIssues} from './PermissionOptions';
import {roleLabel,type AccessCatalog} from './permission-types';

export default function RolePermissionSettings({catalog,onChanged}:{catalog:AccessCatalog;onChanged:()=>Promise<void>}){
 const [roleId,setRoleId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[selectionValid,setSelectionValid]=useState(true);
 const lock=useRef(false),role=catalog.roles.find(r=>r.id===roleId);
 const selectionValidity=useCallback((valid:boolean)=>{setSelectionValid(valid);if(valid)setError('');},[]);
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(lock.current||!role?.revision)return;const form=new FormData(e.currentTarget),selection=form.getAll('permissionId').map(String).sort(),issues=permissionSelectionIssues(catalog,role.id,selection,'template');
  if(issues.length){setSelectionValid(false);setError('O padrão ainda contém ações incompatíveis. Confira a lista com os nomes e motivos abaixo.');return;}
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await apiRequest<{message:string}>(`/api/v1/admin/user-requests/roles/${encodeURIComponent(role.id)}`,{method:'POST',body:{revision:role.revision,permissionIds:form.getAll('permissionId').map(String).sort(),reason:String(form.get('reason')??'').trim()}});setNotice(result.message);await onChanged();}
  catch(e){setError((e instanceof Error?e.message:'Não foi possível confirmar a configuração.')+' Confira a revisão antes de repetir.');}
  finally{lock.current=false;setBusy(false);}
 }
 if(catalog.metadataVersion!==2)return null;
 return <details style={{marginBlock:16,padding:16,border:'1px solid var(--color-border, #70869d)',borderRadius:12}}>
  <summary style={{fontWeight:700,cursor:'pointer'}}>Configurar padrão das funções · somente Administrador</summary>
  <p>O padrão será usado nos novos convites. Usuários já cadastrados mantêm seus acessos; para conceder as novas ações a uma pessoa, use a área de permissões individuais abaixo.</p>
  {error?<Alert variant="error">{error}</Alert>:null}{notice?<p role="status">{notice}</p>:null}
  <CustomerSelector label="Função para configurar" placeholder="Escolha a função" customers={catalog.roles.filter(r=>r.canConfigure).map(r=>({id:r.id,company_name:roleLabel[r.name]||r.name}))} value={roleId} disabled={busy} onChange={id=>{setRoleId(id);setError('');setNotice('');}}/>
  {role?<form key={role.id+role.revision} onSubmit={save} style={{display:'grid',gap:14,marginTop:12}}>
   <PermissionOptions catalog={catalog} roleId={role.id} mode="template" selected={role.defaultPermissions??role.permissions} disabled={busy} onValidityChange={selectionValidity}/>
   <label>Justificativa da configuração<textarea className="ds-input" name="reason" minLength={10} maxLength={1000} required disabled={busy}/></label>
   <label><input type="checkbox" required disabled={busy}/>Conferi o padrão. Os acessos dos usuários existentes serão preservados e novas concessões individuais exigirão decisão própria.</label>
   {!selectionValid?<p>Para salvar, retire ou corrija as ações indicadas em “Ações que impedem salvar”.</p>:null}
   <Button type="submit" disabled={busy||!selectionValid}>{busy?'Salvando configuração…':'Salvar padrão da função'}</Button>
  </form>:null}
 </details>;
}
