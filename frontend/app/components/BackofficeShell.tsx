'use client';
import { ReactNode, useState, useEffect } from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';

import OperationNotificationBell from '@/app/components/OperationNotificationBell';
import UserIdentity from '@/app/components/UserIdentity';
import Sidebar from '@/app/components/Sidebar';
import BotEnergyBackoffice from '@/app/components/BotEnergyBackoffice';
import BackofficeAudience from '@/app/components/BackofficeAudience';
import {useAuth} from '@/app/providers';
import {isOrganizationAuthContext} from '@/app/lib/auth/organization-context';

interface BackofficeShellProps {
  children: ReactNode;
}

export default function BackofficeShell({
  children,
}: BackofficeShellProps) {
  const [collapsed,setCollapsed]=useState(false);
  const pathname=usePathname();
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant' as ScrollBehavior});},[pathname]);
  const {context}=useAuth();
  const content=(
    <div className={`backoffice${collapsed?' backoffice--collapsed':''}`}>
      <Sidebar collapsed={collapsed} onToggle={()=>setCollapsed(value=>!value)} />

      <main className="backoffice-main">
        <div className="environment-topbar">{isOrganizationAuthContext(context)&&!context.accessMode&&['admin_org','gestor','operacional'].includes(context.currentOrganization.role)?<Link className="operation-bell" href="/backoffice/support">Atendimento Central</Link>:null}<OperationNotificationBell /><UserIdentity /></div>
        {children}
        <BotEnergyBackoffice />
      </main>
    </div>
  );
  return isOrganizationAuthContext(context)&&context.currentOrganization.role==='consulta'&&!context.accessMode?<BackofficeAudience key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.role,context.currentOrganization.permissions])} organizationId={context.currentOrganization.id}>{content}</BackofficeAudience>:content;
}
