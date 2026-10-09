'use client';
import Link from 'next/link';
import ClientPortalContent from '@/app/components/ClientPortalContent';
import portalStyles from './portal.module.css';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/app/providers';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert,Button} from '@/app/components/ui';
export default function ClientPortalPage(){
 const {context,logout,hasPermission}=useAuth(),router=useRouter();
 const eligible=context?.scope==='organization'&&context.currentOrganization.role==='consulta'&&!context.accessMode&&hasPermission('3ebadd32-6f30-459e-8ed3-0d2843d89946');
 return <ProtectedRoute><div className={portalStyles.layout}><nav className={portalStyles.sidebar} aria-label="Menu do Portal"><strong>EnergyOS</strong><Link href="/portal" aria-current="page">Dashboard</Link><a href="#adesao">Adesão ACL</a><a href="#documentos">Documentos</a><a href="#financeiro">Financeiro publicado</a><a href="#previsao">Previsão de consumo</a><a href="#bot-energy">Bot-Energy</a></nav><main className="client-portal"><header className="auth-brand"><h1 className="auth-brand__name">EnergyOS</h1><p className="auth-brand__description auth-brand__powered">Powered by Expert Energy</p><h2>Portal do cliente</h2></header>
 {eligible?<ClientPortalContent key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.permissions])}/>:<Alert>Este ambiente exige perfil de consulta externa, permissão de relatórios e vínculo com um cliente. Solicite a conferência à equipe de gestão.</Alert>}
 <footer><Button variant="secondary" onClick={()=>{logout();router.replace('/auth/login');}}>Sair</Button></footer></main></div></ProtectedRoute>;
}
