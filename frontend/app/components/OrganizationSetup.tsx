'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input } from '@/app/components/ui';
import { Organization } from '@/app/lib/api/organizations';
import { apiRequest } from '@/app/lib/api/client';
import { PLATFORM_PERMISSIONS } from '@/app/lib/permissions';
import { useAuth } from '@/app/providers';

const fields = [
  ['legalName','Razão social',200],['tradeName','Nome fantasia',200],['taxId','CNPJ (sem pontuação)',14],
  ['address','Endereço',300],['postalCode','CEP',30],['city','Cidade',100],['state','Estado',100],['country','País',100],
  ['contactName','Contato',200],['phone','Telefone',30],['email','E-mail de contato',254],['responsibleName','Responsável',200],['notes','Observações',2000],
] as const;

export default function OrganizationSetup({ organization }: { organization: Organization }) {
  const { hasPermission, enterOrganization } = useAuth();
  const router = useRouter();
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form=new FormData(event.currentTarget);
    const registration: Record<string,string>={};
    for (const [key] of fields) { const value=String(form.get(key)||'').trim(); if(value) registration[key]=value; }
    if(registration.taxId) registration.taxId=registration.taxId.replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
    setBusy(true);setError('');setMessage('');
    try { await apiRequest('/api/v1/admin/organizations/'+encodeURIComponent(organization.id)+'/registration',{method:'PATCH',body:registration});setMessage('Dados cadastrais salvos.'); }
    catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}
  }
  async function enter(){
    setBusy(true);setError('');
    try{await enterOrganization(organization.id);router.push('/backoffice/dashboard');}
    catch(e){setError(e instanceof Error?e.message:'Não foi possível entrar.');}finally{setBusy(false);}
  }
  return <div>
    {error ? <Alert variant="error">{error}</Alert>:null}
    {message ? <Alert>{message}</Alert>:null}
    {hasPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_UPDATE) ? <details>
      <summary>Dados empresariais e contatos</summary>
      <form onSubmit={save} className="organizations-create__form">
        {fields.map(([key,label,max])=><Input key={key} name={key} label={label} defaultValue={organization.registration?.[key]||''} maxLength={max} type={key==='email'?'email':'text'} disabled={busy}/>)}
        <Button type="submit" disabled={busy}>Salvar dados cadastrais</Button>
      </form>
    </details>:null}
    {hasPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_OPERATE) ? <div className="organizations-card__actions">
      <Button disabled={busy} onClick={()=>void enter()}>{busy?'Aguarde...':'Administrar e operar organização'}</Button>
    </div>:null}
  </div>;
}
