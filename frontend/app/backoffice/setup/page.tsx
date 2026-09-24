'use client';
import { FormEvent, useEffect, useState } from 'react';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import { Alert, Button, Card, Input } from '@/app/components/ui';
import { apiRequest } from '@/app/lib/api/client';
import { useAuth } from '@/app/providers';
import CustomerIdentity from '@/app/components/CustomerIdentity';
import {validTaxId,normalizeTaxId} from '@/app/lib/tax-id';
type Customer={id:string;company_name:string;document:string};
type Unit={id:string;name:string;consumer_unit_number:string};
function Setup(){
 const {hasPermission}=useAuth();const [customers,setCustomers]=useState<Customer[]>([]),[units,setUnits]=useState<Unit[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const canView=hasPermission('cbb2e904-0718-4eec-9396-dba899118cdd'),viewUnits=hasPermission('b142bd7b-05a3-45ee-befd-e593066c2775');
 useEffect(()=>{let cancelled=false;if(!canView)return;Promise.all([apiRequest<Customer[]>('/api/v1/customers'),viewUnits?apiRequest<Unit[]>('/api/v1/consumer-units'):Promise.resolve([])]).then(([c,u])=>{if(!cancelled){setCustomers(c);setUnits(u);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[canView,viewUnits]);
 async function save(e:FormEvent<HTMLFormElement>,unit:boolean){e.preventDefault();if(busy)return;const form=e.currentTarget;const f=new FormData(form);const body=Object.fromEntries(Array.from(f.entries()).map(([k,v])=>[k,String(v).trim()]).filter(([,v])=>v!==''));if(!unit){if(!validTaxId(body.document||'')){setError('CPF ou CNPJ inválido. Confira o número.');return;}body.document=normalizeTaxId(body.document);}setBusy(true);setError('');setMessage('');
 try{if(unit){const row=await apiRequest<Unit>('/api/v1/consumer-units',{method:'POST',body});setUnits(old=>[...old,row]);}else{const row=await apiRequest<Customer>('/api/v1/customers',{method:'POST',body});setCustomers(old=>[...old,row]);}form.reset();setMessage(unit?'Unidade cadastrada. Você já pode selecionar seus documentos.':'Cliente cadastrado. Cadastre agora a unidade consumidora.');}
 catch(ex){setError(ex instanceof Error?ex.message:'Não foi possível cadastrar.');}finally{setBusy(false);}}
 if(!canView)return <p>Acesso não autorizado.</p>;
 return <section className="backoffice-page"><h1>Clientes e unidades</h1><p>Cadastre os vínculos necessários aos documentos da organização ativa.</p>{error?<Alert variant="error">{error}</Alert>:null}{message?<Alert>{message}</Alert>:null}
 <Card title="Clientes cadastrados">{customers.length?customers.map(c=><p key={c.id}>{c.company_name} · {c.document}</p>):<p>Nenhum cliente carregado.</p>}</Card>
 {hasPermission('ac18624a-9fc7-49a1-9680-9a4cf47ec492')?<Card title="Novo cliente"><form onSubmit={e=>void save(e,false)} className="organizations-create__form">
 <CustomerIdentity disabled={busy}/><Input label="Contato" name="contact_name" disabled={busy}/><Input label="E-mail" name="contact_email" type="email" disabled={busy}/><Input label="Telefone" name="contact_phone" disabled={busy}/><Button type="submit" disabled={busy}>Cadastrar cliente</Button></form></Card>:null}
 {viewUnits?<Card title="Unidades cadastradas">{units.length?units.map(u=><p key={u.id}>{u.name} · {u.consumer_unit_number}</p>):<p>Nenhuma unidade carregada.</p>}</Card>:null}
 {hasPermission('05613764-311a-4e71-ac99-475ad1dfe87a')?<Card title="Nova unidade consumidora"><form onSubmit={e=>void save(e,true)} className="organizations-create__form"><label>Cliente<select className="ds-input" name="customerId" required disabled={busy}><option value="">Selecione</option>{customers.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select></label>
 <Input label="Nome da unidade" name="name" maxLength={255} required disabled={busy}/><Input label="Número da unidade / instalação" name="code" maxLength={20} required disabled={busy}/><Input label="Distribuidora" name="distributor" maxLength={50} required disabled={busy}/><Input label="Grupo tarifário" name="tariffGroup" maxLength={10} required disabled={busy}/>
 <label>Modalidade tarifária<select className="ds-input" name="tariffModality" disabled={busy}><option value="">Não informada</option><option value="BLUE">Azul</option><option value="GREEN">Verde</option><option value="WHITE">Branca</option><option value="CONVENTIONAL">Convencional</option></select></label>
 <Input label="Endereço" name="address" maxLength={1000} disabled={busy}/><Input label="Cidade" name="city" maxLength={255} disabled={busy}/><Input label="Estado" name="state" maxLength={50} disabled={busy}/><Button type="submit" disabled={busy||!customers.length}>Cadastrar unidade</Button></form></Card>:null}</section>;
}
export default function Page(){const {context}=useAuth();const id=context&&context.scope!=='global'?context.currentOrganization.id:'';return <ProtectedRoute><BackofficeShell>{id?<Setup key={id}/>:<p>Selecione uma organização para operar.</p>}</BackofficeShell></ProtectedRoute>;}
