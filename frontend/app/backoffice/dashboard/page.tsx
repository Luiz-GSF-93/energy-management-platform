'use client';

import Link from 'next/link';
import { useAuth } from '@/app/providers';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import DashboardMetrics from '@/app/components/DashboardMetrics';

export default function DashboardPage() {
  const { context, hasPermission } = useAuth();
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

          <section className="ds-card">
            <h2>{context?.scope === 'global' ? 'Administração da plataforma' : 'Organização em operação'}</h2>
            {context?.scope === 'global' ? <>
              <p>Cadastre uma organização e abra “Administrar e operar organização”. Dentro dela, configure a licença, consulte os usuários e cadastre clientes e unidades para enviar documentos.</p>
              <Link href="/backoffice/organizations">Gerenciar organizações</Link>
            </> : <>
              <p>Você está trabalhando em {context?.currentOrganization.name || context?.currentOrganization.id}. Os dados e as ações ficam vinculados a essa organização.</p>
              {hasPermission('8c5673e4-115c-4ab7-bb11-3b410eddcad3') ? <p><Link href="/backoffice/licenses">Configurar licença e módulos</Link></p> : null}
              {hasPermission('cbb2e904-0718-4eec-9396-dba899118cdd') ? <p><Link href="/backoffice/setup">Cadastrar clientes e unidades</Link></p> : null}
              {hasPermission('60f9690a-145b-4dba-b23f-9f945baca296') ? <p><Link href="/backoffice/contracts">Cadastrar e consultar contratos</Link></p> : null}
              {hasPermission('8f105b02-4443-49de-b188-847e0284e7ed') ? <p><Link href="/backoffice/documents">Enviar e consultar documentos</Link></p> : null}
            </>}
          </section>
          {context?<DashboardMetrics key={context.scope==='global'?'global':context.currentOrganization.id} organizationId={context.scope==='global'?null:context.currentOrganization.id}/>:null}
        </section>
      </BackofficeShell>
    </ProtectedRoute>
  );
}
