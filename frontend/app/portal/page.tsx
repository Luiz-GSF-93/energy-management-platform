'use client';
import {useRouter} from 'next/navigation';
import {useAuth} from '@/app/providers';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import ClientEvidenceInbox from '@/app/components/ClientEvidenceInbox';
import PublishedFinancialDashboard from '@/app/components/PublishedFinancialDashboard';
import {Alert,Button} from '@/app/components/ui';
export default function ClientPortalPage(){
 const {context,logout,hasPermission}=useAuth(),router=useRouter();
 const eligible=context?.scope==='organization'&&context.currentOrganization.role==='consulta'&&!context.accessMode&&hasPermission('3ebadd32-6f30-459e-8ed3-0d2843d89946');
 return <ProtectedRoute><main className="client-portal"><header className="auth-brand"><h1 className="auth-brand__name">EnergyOS</h1><p className="auth-brand__description auth-brand__powered">Powered by Expert Energy</p><h2>Portal do cliente</h2></header>
 {eligible?<><ClientEvidenceInbox key={context.user.id+context.currentOrganization.id}/><PublishedFinancialDashboard key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.role,context.currentOrganization.permissions])} audience="client" organizationId={context.currentOrganization.id} organizationName={context.currentOrganization.name||context.currentOrganization.id}/></>:<Alert>Este ambiente exige perfil de consulta externa, permissão de relatórios e vínculo com um cliente. Solicite a conferência à equipe de gestão.</Alert>}
 <footer><Button variant="secondary" onClick={()=>{logout();router.replace('/auth/login');}}>Sair</Button></footer></main></ProtectedRoute>;
}
