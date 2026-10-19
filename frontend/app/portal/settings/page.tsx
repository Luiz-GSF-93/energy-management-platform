"use client";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import PortalWorkspace from "@/app/components/PortalWorkspace";
import {useAuth} from '@/app/providers';
import {isOrganizationAuthContext} from '@/app/lib/auth/organization-context';
import {Alert} from '@/app/components/ui';
export default function PortalSettingsPage() {
  const {context}=useAuth();
  return (
    <ProtectedRoute>
      {isOrganizationAuthContext(context)&&context.currentOrganization.role==='consulta'&&!context.accessMode?<PortalWorkspace key={context.user.id+'|'+context.currentOrganization.id} settings/>:<Alert>Use o perfil externo vinculado ao Portal.</Alert>}
    </ProtectedRoute>
  );
}
