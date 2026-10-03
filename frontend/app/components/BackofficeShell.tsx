'use client';
import { ReactNode, useState } from 'react';

import OperationNotificationBell from '@/app/components/OperationNotificationBell';
import Sidebar from '@/app/components/Sidebar';
import BotEnergyBackoffice from '@/app/components/BotEnergyBackoffice';
import BackofficeAudience from '@/app/components/BackofficeAudience';
import {useAuth} from '@/app/providers';

interface BackofficeShellProps {
  children: ReactNode;
}

export default function BackofficeShell({
  children,
}: BackofficeShellProps) {
  const [collapsed,setCollapsed]=useState(false);
  const {context}=useAuth();
  const content=(
    <div className={`backoffice${collapsed?' backoffice--collapsed':''}`}>
      <Sidebar collapsed={collapsed} onToggle={()=>setCollapsed(value=>!value)} />

      <main className="backoffice-main">
        <OperationNotificationBell />
        {children}
        <BotEnergyBackoffice />
      </main>
    </div>
  );
  return context?.scope==='organization'&&context.currentOrganization.role==='consulta'&&!context.accessMode?<BackofficeAudience key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.role,context.currentOrganization.permissions])} organizationId={context.currentOrganization.id}>{content}</BackofficeAudience>:content;
}
