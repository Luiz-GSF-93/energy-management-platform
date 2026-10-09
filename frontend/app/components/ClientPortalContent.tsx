'use client';
import {useEffect,useState} from 'react';
import {loadPortalLicense,PortalEntitlement,PortalModule} from '@/app/lib/api/portal-licenses';
import {useAuth} from '@/app/providers';
import {Alert,Button} from './ui';
import EnergyPriceDashboard from './EnergyPriceDashboard';
import ClientEvidenceInbox from './ClientEvidenceInbox';
import AclAdmissionStatus from './AclAdmissionStatus';
import PublishedForecastDashboard from './PublishedForecastDashboard';
import PublishedFinancialDashboard from './PublishedFinancialDashboard';
import BotEnergyReports from './BotEnergyReports';
export default function ClientPortalContent(){
 const checkLicense=process.env.NEXT_PUBLIC_CLIENT_PORTAL_LICENSES_ENABLED==='true';
 const {context}=useAuth();const [license,setLicense]=useState<PortalEntitlement|null>(checkLicense?null:{enabled:false}),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(!checkLicense)return;let active=true;loadPortalLicense<PortalEntitlement>('/api/v1/portal/license',{enabled:false}).then(value=>{if(active){if(typeof value?.enabled!=='boolean'||(value.enabled&&!Array.isArray(value.modules)))throw new Error('Não foi possível confirmar as condições do Portal.');setLicense(value);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Licença não confirmada.');});return()=>{active=false;};},[attempt,checkLicense]);
 if(!context||context.scope!=='organization')return null;
 if(error)return <Alert variant="error">{error} <Button variant="secondary" onClick={()=>{setError('');setLicense(null);setAttempt(a=>a+1);}}>Conferir novamente</Button></Alert>;
 if(!license)return <p>Conferindo o acesso ao Portal…</p>;
 const allowed=(module:PortalModule)=>!license.enabled||license.modules?.includes(module);
 const key=JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.permissions]);
 return <>{license.enabled?<p>Licença do Portal: {license.starts} a {license.ends}. Os resultados exibidos são publicados e pertencem à empresa vinculada ao seu usuário.</p>:null}
 {allowed('energy_prices')?<EnergyPriceDashboard key={'price:'+key} audience="client" organizationId={context.currentOrganization.id}/>:null}
 {allowed('acl')?<div id="adesao"><AclAdmissionStatus key={'acl:'+key}/></div>:null}
 {allowed('documents')?<div id="documentos"><ClientEvidenceInbox key={'documents:'+key}/></div>:null}
 {allowed('reports')?<div id="financeiro"><PublishedFinancialDashboard key={'financial:'+key} audience="client" organizationId={context.currentOrganization.id} organizationName={context.currentOrganization.name||context.currentOrganization.id}/></div>:null}
 {allowed('forecasts')?<div id="previsao"><PublishedForecastDashboard key={'forecast:'+key}/></div>:null}
 {allowed('bot')?<div id="bot-energy"><BotEnergyReports key={'bot:'+key} audience="client"/></div>:null}
 {license.enabled&&!license.modules?.length?<Alert>Nenhum módulo foi incluído na licença do Portal. Solicite a conferência à equipe de gestão.</Alert>:null}</>;
}
