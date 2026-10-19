'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {PanelLeftClose,PanelLeftOpen,LayoutDashboard,TrendingUp,FileSignature,Files,ChartNoAxesCombined,Bot,Settings,LogOut} from 'lucide-react';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api/client';
import {loadPortalLicense,PortalEntitlement,PortalModule} from '@/app/lib/api/portal-licenses';
import UserIdentity,{UserWelcome} from './UserIdentity';
import EnergyOSLogo from './EnergyOSLogo';
import ClientPortalContent from './ClientPortalContent';
import AccountSettings from './AccountSettings';
import {Alert,Button} from './ui';
import styles from '../portal/portal.module.css';
export const portalNavigation=[
 {id:'financeiro',label:'Resultados e economia',module:'reports',icon:LayoutDashboard},
 {id:'precos',label:'Preços da energia',module:'energy_prices',icon:TrendingUp},
 {id:'adesao',label:'Adesão ACL',module:'acl',icon:FileSignature},
 {id:'documentos',label:'Documentos',module:'documents',icon:Files},
 {id:'previsao',label:'Previsão de consumo',module:'forecasts',icon:ChartNoAxesCombined},
 {id:'bot-energy',label:'Conversar com EVA',module:'bot',icon:Bot},
] as const;
export default function PortalWorkspace({settings=false}:{settings?:boolean}={}){
 const {context,logout}=useAuth(),router=useRouter(),org=context?.scope==='organization'?context.currentOrganization.id:'';
 const check=process.env.NEXT_PUBLIC_CLIENT_PORTAL_LICENSES_ENABLED==='true';
 const [license,setLicense]=useState<PortalEntitlement|null>(null),[branding,setBranding]=useState<{organizationId:string;name:string;logo:string}|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[collapsed,setCollapsed]=useState(false),[active,setActive]=useState('');
 useEffect(()=>{if(!org)return;const abort=new AbortController();let live=true;
  loadPortalLicense<PortalEntitlement>('/api/v1/portal/license',{enabled:false}).then(b=>{if(typeof b?.enabled!=='boolean'||b.enabled&&!Array.isArray(b.modules))throw Error('Licença do Portal não confirmada.');if(live)setLicense(b);}).catch(e=>{if(live)setError(e.message);});
  apiRequest<{organizationId:string;name:string;logo:string}>('/api/v1/organization-branding',{cache:'no-store',signal:abort.signal}).then(b=>{if(live&&b.organizationId===org&&typeof b.name==='string'&&typeof b.logo==='string'&&(b.logo===''||/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(b.logo)))setBranding(b);}).catch(()=>{/* Name from the authenticated context remains the safe fallback. */});
  return()=>{live=false;abort.abort();};
 },[org,attempt]);
 const modules=portalNavigation.filter(item=>license&&(!check||license.enabled&&license.modules?.includes(item.module as PortalModule)));
 const name=branding?.organizationId===org?branding.name:context?.scope==='organization'?context.currentOrganization.name||'Organização contratante':'Organização contratante';
 return <div className={styles.layout+' '+(collapsed?styles.collapsed:'')}><aside className={styles.sidebar}><div className={styles.brand}><EnergyOSLogo compact/><span>EnergyOS</span></div><Button variant="secondary" aria-label={collapsed?'Expandir menu do Portal':'Recolher menu do Portal'} aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}>{collapsed?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}</Button><nav aria-label="Menu do Portal">{modules.map(item=><a key={item.id} href={(settings?'/portal':'')+'#'+item.id} title={item.label} aria-label={item.label} aria-current={!settings&&(active||modules[0]?.id)===item.id?'page':undefined} onClick={()=>setActive(item.id)}><item.icon size={20}/><span>{item.label}</span></a>)}<Link href="/portal/settings" title="Configurações" aria-label="Configurações" aria-current={settings?'page':undefined}><Settings size={20}/><span>Configurações</span></Link></nav><button className={styles.logout} onClick={()=>{logout();router.replace('/auth/login');}} title="Sair" aria-label="Sair"><LogOut size={20}/><span>Sair</span></button></aside><main className={styles.main+' client-portal'}><div className={styles.topbar}><div><strong>EnergyOS</strong><span>{name}</span></div><UserIdentity portal/></div><UserWelcome/><header className={styles.organization}>{branding?.organizationId===org&&branding.logo?<img src={branding.logo} alt={'Logomarca de '+name}/>:null}<p>Seu ambiente de energia</p><h1>{name}</h1><span>Portal do cliente · Powered by Expert Energy</span></header>{error?<Alert variant="error">{error}<Button onClick={()=>{setError('');setLicense(null);setAttempt(v=>v+1);}}>Conferir acesso novamente</Button></Alert>:!license?<p role="status">Conferindo módulos do Portal…</p>:check&&!license.enabled?<Alert>O Portal ainda não foi liberado para este cliente.</Alert>:settings?<AccountSettings/>:<ClientPortalContent entitlement={license}/>}</main></div>;
}
