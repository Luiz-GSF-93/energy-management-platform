import { ReactNode } from 'react';

import Sidebar from '@/app/components/Sidebar';
import BotEnergyBackoffice from '@/app/components/BotEnergyBackoffice';

interface BackofficeShellProps {
  children: ReactNode;
}

export default function BackofficeShell({
  children,
}: BackofficeShellProps) {
  return (
    <div className="backoffice">
      <Sidebar />

      <main className="backoffice-main">
        {children}
        <BotEnergyBackoffice />
      </main>
    </div>
  );
}
