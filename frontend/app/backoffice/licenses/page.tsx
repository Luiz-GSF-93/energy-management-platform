'use client';
import { FormEvent, useEffect, useState } from 'react';
import LicenseFromPlan from '@/app/components/LicenseFromPlan';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import { Alert, Button, Card, Input } from '@/app/components/ui';
import { apiRequest } from '@/app/lib/api/client';
import { useAuth } from '@/app/providers';

type License = { plan_id?:string|null;plan_version?:number|null;max_users?:number|null; id:string;license_type:string;status:string;documents_limit:number;documents_used:number;start_date:string;end_date:string|null;renewal_date:string;max_consumer_units:number;document_management:boolean;advanced_analytics:boolean;report_generation:boolean;free_market_management:boolean };
const modules=[['documentManagement','document_management','Documentos'],['advancedAnalytics','advanced_analytics','Análises avançadas'],['reportGeneration','report_generation','Relatórios'],['freeMarketManagement','free_market_management','Gestão do mercado livre']] as const;
function Licenses(){
 const {hasPermission}=useAuth();
 const [rows,setRows]=useState<License[]>([]),[editing,setEditing]=useState<License|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const view=hasPermission('8c5673e4-115c-4ab7-bb11-3b410eddcad3');
 const create=hasPermission('c8cf7769-bfe2-4383-b3e4-f45619724c50'),update=hasPermission('5a645f0d-8c70-42c2-b7d6-631371d3a613');
 useEffect(()=>{let cancelled=false;if(!view)return;apiRequest<License[]>('/api/v1/licenses').then(r=>{if(!cancelled)setRows(r);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[view]);
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;const form=e.currentTarget,f=new FormData(form);const body:Record<string,unknown>={};
  for(const key of ['licenseType','startDate','renewalDate'])body[key]=String(f.get(key)||'').trim();
  if(f.get('endDate'))body.endDate=String(f.get('endDate'));
  body.documentsLimit=Number(f.get('documentsLimit'));body.maxConsumerUnits=Number(f.get('maxConsumerUnits'));
  for(const [key] of modules)body[key]=f.has(key);if(editing)body.status=String(f.get('status'));
  setBusy(true);setError('');setMessage('');
  try{await apiRequest('/api/v1/licenses'+(editing?'/'+encodeURIComponent(editing.id):''),{method:editing?'PATCH':'POST',body});setRows(await apiRequest<License[]>('/api/v1/licenses'));setEditing(null);form.reset();setMessage('Licença salva. Os módulos continuam sujeitos à disponibilidade de cada funcionalidade.');}
  catch(ex){setError(ex instanceof Error?ex.message:'Falha ao salvar.');}finally{setBusy(false);}
 }
 if(!view)return <p>Acesso à licença não autorizado.</p>;
 return <section className="backoffice-page"><h1>Licença e módulos</h1><p>Configure a licença da organização ativa. Uma licença não substitui as permissões dos usuários.</p>
 {error?<Alert variant="error">{error}</Alert>:null}{message?<Alert>{message}</Alert>:null}
 {create?<LicenseFromPlan onCreated={async()=>{setRows(await apiRequest<License[]>('/api/v1/licenses'));}}/>:null}
 {loading?<p>Carregando licenças...</p>:rows.map(l=><Card key={l.id} title={l.license_type}><p>{l.plan_id?'Plano aplicado: versão '+l.plan_version:'Licença personalizada'} · Limite de usuários: {l.max_users??'não definido'}</p><p>Status: {l.status} · Documentos: {l.documents_used||0}/{l.documents_limit}</p><p>Vigência: {l.start_date} a {l.end_date||'sem término definido'}</p>{update?<Button variant="secondary" disabled={busy} onClick={()=>{setEditing(l);setMessage('');}}>Editar licença</Button>:null}</Card>)}
 {(editing?update:create)?<Card title={editing?'Editar licença':'Nova licença'}><form key={editing?.id||'new'} onSubmit={save} className="organizations-create__form">
 <Input label="Plano / tipo de licença" name="licenseType" required defaultValue={editing?.license_type||''} disabled={busy}/>
 <Input label="Início da vigência" name="startDate" type="date" required defaultValue={editing?.start_date||''} disabled={busy}/>
 <Input label="Término da vigência" name="endDate" type="date" defaultValue={editing?.end_date||''} disabled={busy}/>
 <Input label="Data de renovação" name="renewalDate" type="date" required defaultValue={editing?.renewal_date||''} disabled={busy}/>
 <Input label="Limite de documentos" name="documentsLimit" type="number" min={0} step={1} required defaultValue={editing?.documents_limit??100} disabled={busy}/>
 <Input label="Limite de unidades consumidoras" name="maxConsumerUnits" type="number" min={0} step={1} required defaultValue={editing?.max_consumer_units??10} disabled={busy}/>
 {modules.map(([key,column,label])=><label key={key}><input type="checkbox" name={key} defaultChecked={editing?.[column]??false} disabled={busy}/> {label}</label>)}
 <p>Análises avançadas e relatórios ainda dependem da implementação dos respectivos módulos.</p>
 {editing?<label>Status<select className="ds-input" name="status" defaultValue={editing.status.toLowerCase()} disabled={busy}><option value="active">Ativa</option><option value="suspended">Suspensa</option><option value="expired">Expirada</option><option value="cancelled">Cancelada</option></select></label>:null}
 <Button type="submit" disabled={busy}>{busy?'Salvando...':'Salvar licença'}</Button>{editing?<Button variant="secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancelar edição</Button>:null}
 </form></Card>:null}</section>;
}
export default function Page(){const {context}=useAuth();const id=context&&context.scope!=='global'?context.currentOrganization.id:'';return <ProtectedRoute><BackofficeShell>{id?<Licenses key={id}/>:<p>Selecione uma organização na administração da plataforma.</p>}</BackofficeShell></ProtectedRoute>;}
