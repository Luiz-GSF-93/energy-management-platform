import './globals.css';

import { AuthProvider } from '@/app/providers';

export const metadata = {
  title: 'Energy Management Platform',
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
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
