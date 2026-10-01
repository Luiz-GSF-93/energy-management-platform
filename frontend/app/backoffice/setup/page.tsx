'use client';
import RegistrationEditor from './RegistrationEditor';
import styles from './setup.module.css';
import { FormEvent, useEffect, useRef, useState } from 'react';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import { Alert, Button, Card, Input } from '@/app/components/ui';
import { apiRequest } from '@/app/lib/api/client';
import { useAuth } from '@/app/providers';
import CustomerIdentity from '@/app/components/CustomerIdentity';
import {validTaxId,normalizeTaxId} from '@/app/lib/tax-id';
type Customer={id:string;company_name:string;document:string;status?:string};
type Unit={id:string;name:string;consumer_unit_number:string};
function Setup(){
 const dialog=useRef<HTMLDialogElement>(null),unitsList=useRef<HTMLDetailsElement>(null);
 const [creating,setCreating]=useState<'customer'|'unit'|null>(null),[formError,setFormError]=useState('');
 useEffect(()=>{if(creating&&!dialog.current?.open)dialog.current?.showModal();},[creating]);
 function openRegistration(kind:'customer'|'unit'){setFormError('');setCreating(kind);}
 const [editing,setEditing]=useState<{kind:'customers'|'consumer-units';id:string;readOnly?:boolean}|null>(null);
 const {hasPermission}=useAuth();const [customers,setCustomers]=useState<Customer[]>([]),[units,setUnits]=useState<Unit[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const canView=hasPermission('cbb2e904-0718-4eec-9396-dba899118cdd'),viewUnits=hasPermission('b142bd7b-05a3-45ee-befd-e593066c2775');
 useEffect(()=>{let cancelled=false;if(!canView)return;Promise.all([apiRequest<Customer[]>('/api/v1/customers'),viewUnits?apiRequest<Unit[]>('/api/v1/consumer-units'):Promise.resolve([])]).then(([c,u])=>{if(!cancelled){setCustomers(c);setUnits(u);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[canView,viewUnits]);
 async function save(e:FormEvent<HTMLFormElement>,unit:boolean){e.preventDefault();if(busy)return;const form=e.currentTarget;const f=new FormData(form);const body=Object.fromEntries(Array.from(f.entries()).map(([k,v])=>[k,String(v).trim()]).filter(([,v])=>v!==''));if(!unit){if(!validTaxId(body.document||'')){setFormError('CPF ou CNPJ inválido. Confira o número.');return;}body.document=normalizeTaxId(body.document);}setBusy(true);setFormError('');setMessage('');
 try{if(unit){const row=await apiRequest<Unit>('/api/v1/consumer-units',{method:'POST',body});setUnits(old=>[...old,row]);if(unitsList.current)unitsList.current.open=true;}else{const row=await apiRequest<Customer>('/api/v1/customers',{method:'POST',body});setCustomers(old=>[...old,row]);}form.reset();dialog.current?.close();setCreating(null);setMessage(unit?'Unidade cadastrada. Você já pode selecionar seus documentos.':'Cliente cadastrado. Cadastre agora a unidade consumidora.');}
 catch(ex){setFormError(ex instanceof Error?ex.message:'Não foi possível cadastrar.');}finally{setBusy(false);}}
 if(!canView)return <p>Acesso não autorizado.</p>;
 return <section className="backoffice-page"><h1>Clientes e unidades</h1><p>Cadastre os vínculos necessários aos documentos da organização ativa.</p>{error?<Alert variant="error">{error}</Alert>:null}{message?<Alert>{message}</Alert>:null}
 <div className={styles.actions} aria-label="Cadastrar clientes e unidades">
 {hasPermission('ac18624a-9fc7-49a1-9680-9a4cf47ec492')?<Button onClick={()=>openRegistration('customer')}>Cadastrar cliente</Button>:null}
 {hasPermission('05613764-311a-4e71-ac99-475ad1dfe87a')?<Button variant="secondary" disabled={!customers.length} onClick={()=>openRegistration('unit')}>Cadastrar unidade</Button>:null}
 </div>
 {editing?<RegistrationEditor key={editing.kind+editing.id+String(editing.readOnly)} {...editing} onClose={()=>setEditing(null)} onSaved={row=>{if(editing.kind==='customers')setCustomers(old=>old.map(c=>c.id===row.id?{...c,company_name:String(row.company_name??c.company_name),document:String(row.document??c.document),status:row.status}:c));else setUnits(old=>old.map(u=>u.id===row.id?{...u,name:String(row.name??u.name),consumer_unit_number:String(row.consumer_unit_number??u.consumer_unit_number)}:u));setEditing(null);setMessage('Cadastro atualizado com auditoria.'+(row.deactivated_user_ids?.length?' '+row.deactivated_user_ids.length+' usuário(s) desativado(s); vagas liberadas.':''));}}/>:null}
 <Card title="Clientes cadastrados">{customers.length?customers.map(c=><article key={c.id} className="ds-card"><p>{c.company_name} · {c.document} · {c.status==='INACTIVE'?'Inativo':c.status==='ACTIVE'?'Ativo':c.status}</p>{hasPermission('0f80e33b-bb78-4f3d-9f75-22b7977ef885')?<Button variant="secondary" onClick={()=>setEditing({kind:'customers',id:c.id})}>Editar cliente / situação</Button>:null} <Button variant="secondary" onClick={()=>setEditing({kind:'customers',id:c.id,readOnly:true})}>Histórico</Button></article>):<p>Nenhum cliente carregado.</p>}</Card>
 {viewUnits?<details ref={unitsList} className={styles.units}><summary>Unidades cadastradas ({units.length})</summary><Card title="Unidades cadastradas">{units.length?units.map(u=><article key={u.id} className="ds-card"><p>{u.name} · {u.consumer_unit_number}</p>{hasPermission('0f2e539d-03f9-4168-bc8c-55ac3a371628')?<Button variant="secondary" onClick={()=>setEditing({kind:'consumer-units',id:u.id})}>Editar unidade</Button>:null} <Button variant="secondary" onClick={()=>setEditing({kind:'consumer-units',id:u.id,readOnly:true})}>Histórico</Button></article>):<p>Nenhuma unidade carregada.</p>}</Card></details>:null}
 <dialog ref={dialog} className={styles.dialog} aria-labelledby="registration-title" onCancel={e=>{if(busy)e.preventDefault();}} onClose={()=>{setCreating(null);setFormError('');}}>
 <div className={styles.header}><h2 id="registration-title">{creating==='unit'?'Cadastrar unidade':'Cadastrar cliente'}</h2><Button type="button" variant="secondary" disabled={busy} onClick={()=>dialog.current?.close()}>Fechar</Button></div>
 {formError?<Alert variant="error">{formError}</Alert>:null}
 {creating==='customer'&&hasPermission('ac18624a-9fc7-49a1-9680-9a4cf47ec492')?<><form onSubmit={e=>void save(e,false)} className="organizations-create__form">
 <CustomerIdentity disabled={busy}/><Input label="Contato" name="contact_name" disabled={busy}/><Input label="E-mail" name="contact_email" type="email" disabled={busy}/><Input label="Telefone" name="contact_phone" disabled={busy}/><Button type="submit" disabled={busy}>Cadastrar cliente</Button></form></>:null}
 {creating==='unit'&&hasPermission('05613764-311a-4e71-ac99-475ad1dfe87a')?<><form onSubmit={e=>void save(e,true)} className="organizations-create__form"><label>Cliente<select className="ds-input" name="customerId" required disabled={busy}><option value="">Selecione</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
 <Input label="Nome da unidade" name="name" maxLength={255} required disabled={busy}/><Input label="Número da unidade / instalação" name="code" maxLength={20} required disabled={busy}/><Input label="Distribuidora" name="distributor" maxLength={50} required disabled={busy}/><Input label="Grupo tarifário" name="tariffGroup" maxLength={10} required disabled={busy}/>
 <label>Modalidade tarifária<select className="ds-input" name="tariffModality" disabled={busy}><option value="">Não informada</option><option value="BLUE">Azul</option><option value="GREEN">Verde</option><option value="WHITE">Branca</option><option value="CONVENTIONAL">Convencional</option></select></label>
 <Input label="Endereço" name="address" maxLength={1000} disabled={busy}/><Input label="Cidade" name="city" maxLength={255} disabled={busy}/><Input label="Estado" name="state" maxLength={50} disabled={busy}/><Button type="submit" disabled={busy||!customers.length}>Cadastrar unidade</Button></form></>:null} </dialog></section>;
}
export default function Page(){const {context}=useAuth();const id=context&&context.scope!=='global'?context.currentOrganization.id:'';return <ProtectedRoute><BackofficeShell>{id?<Setup key={id}/>:<p>Selecione uma organização para operar.</p>}</BackofficeShell></ProtectedRoute>;}
