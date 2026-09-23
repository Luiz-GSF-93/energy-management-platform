'use client';

import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import { EmptyState } from '@/app/components/ui';

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <BackofficeShell>
        <section className="backoffice-page">
          <header className="backoffice-page__header">
            <h1 className="backoffice-page__title">
              Dashboard administrativo
            </h1>

            <p className="backoffice-page__description">
              Visão consolidada do ambiente de Administração.
            </p>
          </header>

          <EmptyState
            title="Indicadores ainda não configurados"
            description={
              'Os indicadores serão exibidos quando os ' +
              'contratos de agregação do dashboard forem ' +
              'implementados com dados reais do backend.'
            }
          />
        </section>
      </BackofficeShell>
    </ProtectedRoute>
  );
}
