'use client';
import {FormEvent,useEffect,useState} from 'react';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert,Button,Card,Input} from '@/app/components/ui';
import {apiRequest} from '@/app/lib/api/client';
import {getUsers,type OrganizationUser,type OrganizationUserRole} from '@/app/lib/api/users';
import {useAuth} from '@/app/providers';
const labels:Record<string,string>={admin_org:'Administrador da organização',gestor:'Gestor',operacional:'Operador',consulta:'Consulta'};
function Users(){
 const {hasPermission}=useAuth();
 const [rows,setRows]=useState<OrganizationUser[]>([]),[roles,setRoles]=useState<OrganizationUserRole[]>([]),[editing,setEditing]=useState<OrganizationUser|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
 const view=hasPermission('f60e405e-f120-4420-a563-691162504b15');
 const invite=hasPermission('94f57d38-0438-43c5-81bc-5544ab53912a'),update=hasPermission('5f91d918-8def-4bc1-b6c7-37e1ff2d14e2');
 useEffect(()=>{let cancelled=false;if(!view)return;Promise.all([getUsers(),apiRequest<OrganizationUserRole[]>('/api/v1/admin/users/roles')]).then(([u,r])=>{if(!cancelled){setRows(u);setRoles(r);}}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[view]);
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;const form=e.currentTarget,f=new FormData(form);setBusy(true);setError('');setMessage('');
 try{
 const details={name:String(f.get('name')||'').trim(),affiliationType:String(f.get('affiliationType'))};
 if(editing){await apiRequest(`/api/v1/admin/users/${encodeURIComponent(editing.userId)}/details`,{method:'PATCH',body:details});if(String(f.get('roleId'))!==editing.role.id){try{await apiRequest(`/api/v1/admin/users/${encodeURIComponent(editing.userId)}/role`,{method:'PATCH',body:{roleId:String(f.get('roleId'))}});}catch(ex){throw new Error('Nome e vínculo salvos, mas a função não foi alterada. '+(ex instanceof Error?ex.message:''),{cause:ex});}}setMessage('Dados do usuário atualizados nesta organização.');}
 else {const r=await apiRequest<{provisioningPath:string}>('/api/v1/admin/users/invite',{method:'POST',body:{...details,email:String(f.get('email')||'').trim(),roleId:String(f.get('roleId'))}});setMessage(r.provisioningPath==='new_identity'?'Convite enviado. O destinatário deve abrir o e-mail para definir sua senha.':'Usuário existente vinculado a esta organização. Ele pode acessá-la com seu login atual.');}
 setRows(await getUsers());setEditing(null);form.reset();
 }catch(ex){setError(ex instanceof Error?ex.message:'Não foi possível salvar.');}finally{setBusy(false);}}
 if(!view)return <p>Você não possui permissão para consultar usuários.</p>;
 return <section className="backoffice-page"><h1>Usuários da organização</h1><p>O vínculo interno ou externo é específico desta organização. A função define as permissões. Um consultor pode participar de várias organizações.</p><p>Administrador da organização gerencia somente esta organização. Essa função não concede administração global da plataforma.</p>
 {error?<Alert variant="error">{error}</Alert>:null}{message?<Alert>{message}</Alert>:null}
 {(editing?update:invite)?<Card title={editing?'Editar usuário nesta organização':'Convidar ou vincular usuário'}><form className="organizations-create__form" key={editing?.userId||'invite'} onSubmit={save}>
 <Input label="Nome nesta organização" name="name" minLength={2} maxLength={120} required defaultValue={editing?.name||''} disabled={busy}/>
 {!editing?<Input label="E-mail" name="email" type="email" maxLength={254} required disabled={busy}/>:<p>{editing.email}</p>}
 <label>Função<select className="ds-input" name="roleId" required defaultValue={editing?.role.id||''} disabled={busy}><option value="" disabled>Selecione</option>{roles.map(r=><option key={r.id} value={r.id}>{labels[r.name]||r.name}</option>)}</select></label>
 <label>Vínculo<select className="ds-input" name="affiliationType" required defaultValue={editing?.affiliationType||''} disabled={busy}><option value="" disabled>Selecione</option><option value="internal">Interno à organização</option><option value="external">Externo / consultor</option></select></label>
 {!editing?<p>Para uma pessoa já cadastrada, este formulário adiciona somente o vínculo e a função nesta organização. Não altera seu perfil nas demais.</p>:null}
 <Button type="submit" disabled={busy||!roles.length}>{busy?'Salvando...':editing?'Salvar alterações':'Convidar / vincular'}</Button>{editing?<Button variant="secondary" disabled={busy} onClick={()=>setEditing(null)}>Cancelar</Button>:null}
 </form></Card>:null}
 {loading?<p>Carregando usuários...</p>:!rows.length?<p>Nenhum usuário vinculado. O acesso operacional do administrador da plataforma não cria um vínculo de usuário.</p>:rows.map(u=><Card key={u.userId} title={u.name||u.email}><p>{u.email}</p><p>{labels[u.role.name]||u.role.name} · {u.affiliationType==='internal'?'Interno':u.affiliationType==='external'?'Externo':'Vínculo não definido'} · {u.membershipStatus==='active'?'Ativo':'Inativo'}</p>{update&&u.membershipStatus==='active'?<Button variant="secondary" disabled={busy} onClick={()=>{setEditing(u);setError('');setMessage('');}}>Editar</Button>:null}</Card>)}
 </section>;
}
export default function Page(){const {context}=useAuth();const id=context&&context.scope!=='global'?context.currentOrganization.id:'';return <ProtectedRoute><BackofficeShell>{id?<Users key={id}/>:<p>Selecione uma organização.</p>}</BackofficeShell></ProtectedRoute>;}
