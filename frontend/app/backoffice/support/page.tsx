'use client';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import BackofficeShell from '@/app/components/BackofficeShell';
import CentralSupport from '@/app/components/CentralSupport';
import {useAuth} from '@/app/providers';
import {isOrganizationAuthContext} from '@/app/lib/auth/organization-context';
export default function Page(){const {context}=useAuth();return <ProtectedRoute><BackofficeShell>{isOrganizationAuthContext(context)&&!context.accessMode&&['admin_org','gestor','operacional'].includes(context.currentOrganization.role)?<CentralSupport key={context.user.id+':'+context.currentOrganization.id}/>:<p>Atendimento disponível para usuários internos da organização.</p>}</BackofficeShell></ProtectedRoute>;}
