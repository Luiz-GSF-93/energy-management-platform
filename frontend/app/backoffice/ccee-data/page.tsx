'use client';
import {useAuth} from '@/app/providers';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert} from '@/app/components/ui';
import CceeDataWorkspace from './Workspace';
export default function Page(){
 const{context,hasPermission}=useAuth();
 const allowed=context?.scope==='organization'&&(context.accessMode==='platform_operation'||['admin_org','gestor','operacional'].includes(context.currentOrganization.role)&&hasPermission('f5364101-4486-42c2-a90f-807937ac3011'));
 return <ProtectedRoute><BackofficeShell>{allowed&&context?.scope==='organization'?<CceeDataWorkspace key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.permissions,context.accessMode])} organizationId={context.currentOrganization.id}/>:<Alert>Selecione uma organização e um perfil autorizado para consultar dados CCEE.</Alert>}</BackofficeShell></ProtectedRoute>;
}
