import './globals.css';
import './environment.css';
import {UserEnvironmentProvider} from '@/app/providers/UserEnvironmentProvider';

import { AuthProvider } from '@/app/providers';

export const metadata = {
  title: 'EnergyOS',
  description: 'Gestão do Mercado Livre de Energia',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>
          <UserEnvironmentProvider>{children}</UserEnvironmentProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
