'use client';
import PortalWorkspace from '@/app/components/PortalWorkspace';
import {useAuth} from '@/app/providers';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert} from '@/app/components/ui';
import {isOrganizationAuthContext} from '@/app/lib/auth/organization-context';
export default function ClientInvoicesPage(){
 const {context,hasPermission}=useAuth();
 const eligible=isOrganizationAuthContext(context)&&context.currentOrganization.role==='consulta'&&!context.accessMode&&hasPermission('3ebadd32-6f30-459e-8ed3-0d2843d89946');
 return <ProtectedRoute>{eligible?<PortalWorkspace invoices key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.permissions])}/>:<Alert>Este ambiente exige perfil de consulta externa, permissão de relatórios e vínculo com um cliente. Solicite a conferência à equipe de gestão.</Alert>}</ProtectedRoute>;
}
