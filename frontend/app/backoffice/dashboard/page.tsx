'use client';

import {UserWelcome} from '@/app/components/UserIdentity';
import Link from 'next/link';
import { useAuth } from '@/app/providers';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import FeeAdjustmentNotices from '@/app/components/FeeAdjustmentNotices';
import DashboardMetrics from '@/app/components/DashboardMetrics';
import FinancialAnalyticsPanel from '@/app/components/FinancialAnalyticsPanel';
import EnergyPriceDashboard from '@/app/components/EnergyPriceDashboard';
import PublishedFinancialDashboard from '@/app/components/PublishedFinancialDashboard';
import IntegrationRenewal from '@/app/components/IntegrationRenewal';

import CceeIntegration from '@/app/components/CceeIntegration';
import './dashboard.css';

export default function DashboardPage() {
  const { context, hasPermission } = useAuth();
  return (
    <ProtectedRoute>
      <BackofficeShell>
        <section className="backoffice-page energyos-admin-dashboard">
          <UserWelcome/>
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
              <p>As opções disponíveis seguem o perfil da equipe. A gestão de planos, licenças e acessos completos é exclusiva dos Owners.</p>
              {hasPermission('9a679254-bb1a-4353-9d17-cc2bd9eb5abd')?<p><Link href="/backoffice/organizations">Gerenciar organizações</Link></p>:null}
              {hasPermission('82e7fc71-479a-4dd6-8b22-4fba6eaa6841')?<p><Link href="/backoffice/platform-team">Gerenciar equipe da plataforma</Link></p>:null}
              {(hasPermission('699703af-10ba-43a3-8eb8-9f0d9e477498')||hasPermission('e23a5c98-8b68-4ed2-aef8-70a7166407e4'))?<p><Link href="/backoffice/platform-costs">Consultar consumo e gastos por empresa</Link></p>:null}
            </> : <>
              <p>Você está trabalhando em {context?.currentOrganization.name || context?.currentOrganization.id}. Os dados e as ações ficam vinculados a essa organização.</p>
              {hasPermission('8c5673e4-115c-4ab7-bb11-3b410eddcad3') ? <p><Link href="/backoffice/licenses">Consultar plano, consumo e módulos</Link></p> : null}
              {hasPermission('cbb2e904-0718-4eec-9396-dba899118cdd') ? <p><Link href="/backoffice/setup">Cadastrar clientes e unidades</Link></p> : null}
              {hasPermission('60f9690a-145b-4dba-b23f-9f945baca296') ? <p><Link href="/backoffice/contracts">Cadastrar e consultar contratos</Link></p> : null}
              {hasPermission('8f105b02-4443-49de-b188-847e0284e7ed') ? <p><Link href="/backoffice/documents">Enviar e consultar documentos</Link></p> : null}
            </>}
          </section>
          {context?.scope==='global'&&hasPermission('82e7fc71-479a-4dd6-8b22-4fba6eaa6841')?<IntegrationRenewal key={context.user.id}/>:null}
          {context?.scope==='global'&&(hasPermission('82e7fc71-479a-4dd6-8b22-4fba6eaa6841')||hasPermission('c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7'))?<section className="ds-card"><h2>Comunicação da plataforma</h2><p>Consulte modelos, entregas e falhas no ambiente da equipe.</p><Link href="/backoffice/platform-communications">Abrir acompanhamento ↗</Link></section>:null}
          {context?.scope==='global'&&hasPermission('82e7fc71-479a-4dd6-8b22-4fba6eaa6841')?<CceeIntegration key={'ccee-'+context.user.id}/>:null}
          {context?.scope==='organization'&&hasPermission('60f9690a-145b-4dba-b23f-9f945baca296')&&(context.accessMode==='platform_operation'||hasPermission('2c933fdf-0bbf-406a-915c-03e7921e54d8'))?<EnergyPriceDashboard key={'price:'+JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.role,context.currentOrganization.permissions,context.accessMode])} organizationId={context.currentOrganization.id}/>:null}
          {context?.scope==='organization'?<FeeAdjustmentNotices key={context.currentOrganization.id}/>:null}
          {context&&(context.scope!=='global'||hasPermission('9a679254-bb1a-4353-9d17-cc2bd9eb5abd'))?<DashboardMetrics key={context.scope==='global'?'global':context.currentOrganization.id} organizationId={context.scope==='global'?null:context.currentOrganization.id}/>:null}
          {context?.scope==='organization'&&hasPermission('60f9690a-145b-4dba-b23f-9f945baca296')&&(['admin_org','gestor','operacional'].includes(context.currentOrganization.role)||context.accessMode==='platform_operation')?(hasPermission('3ebadd32-6f30-459e-8ed3-0d2843d89946')?<FinancialAnalyticsPanel key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.role,context.currentOrganization.permissions,context.accessMode])} organizationId={context.currentOrganization.id} organizationName={context.currentOrganization.name||context.currentOrganization.id} canPreview={['admin_org','gestor'].includes(context.currentOrganization.role)||context.accessMode==='platform_operation'}/>:<PublishedFinancialDashboard key={JSON.stringify([context.user.id,context.currentOrganization.id,context.currentOrganization.role,context.currentOrganization.permissions,context.accessMode])} organizationId={context.currentOrganization.id} organizationName={context.currentOrganization.name||context.currentOrganization.id} canPreview={['admin_org','gestor'].includes(context.currentOrganization.role)||context.accessMode==='platform_operation'}/>):null}
        </section>
      </BackofficeShell>
    </ProtectedRoute>
  );
}
