'use client';
import { ReactNode, useState } from 'react';

import Sidebar from '@/app/components/Sidebar';
import BotEnergyBackoffice from '@/app/components/BotEnergyBackoffice';

interface BackofficeShellProps {
  children: ReactNode;
}

export default function BackofficeShell({
  children,
}: BackofficeShellProps) {
  const [collapsed,setCollapsed]=useState(false);
  return (
    <div className={`backoffice${collapsed?' backoffice--collapsed':''}`}>
      <Sidebar collapsed={collapsed} onToggle={()=>setCollapsed(value=>!value)} />

      <main className="backoffice-main">
        {children}
        <BotEnergyBackoffice />
      </main>
    </div>
  );
}
