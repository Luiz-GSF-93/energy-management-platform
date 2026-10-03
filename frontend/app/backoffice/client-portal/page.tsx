'use client';
import {Suspense} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useAuth} from '@/app/providers';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import BackofficeShell from '@/app/components/BackofficeShell';
import PublishedFinancialDashboard from '@/app/components/PublishedFinancialDashboard';
import {Alert} from '@/app/components/ui';
function Preview(){
 const {context,hasPermission}=useAuth(),customerId=useSearchParams().get('customerId');
 const allowed=context?.scope==='organization'&&hasPermission('60f9690a-145b-4dba-b23f-9f945baca296')&&(['admin_org','gestor'].includes(context.currentOrganization.role)||context.accessMode==='platform_operation');
 return <ProtectedRoute><BackofficeShell><section className="backoffice-page"><h1>Conferir visão do cliente</h1><p>Prévia somente de leitura. Esta conferência não cria contas nem concede acesso ao cliente.</p><p><Link href="/backoffice/dashboard">Voltar ao dashboard</Link></p>
 {allowed&&customerId&&/^[a-zA-Z0-9-]{1,128}$/.test(customerId)?<PublishedFinancialDashboard key={JSON.stringify([context.user.id,context.currentOrganization.id,customerId,context.currentOrganization.permissions,context.accessMode])} audience="client" previewCustomerId={customerId} organizationId={context.currentOrganization.id} organizationName={context.currentOrganization.name||context.currentOrganization.id}/>:<Alert>Selecione uma publicação no dashboard. A prévia exige gestor ou administrador com acesso financeiro.</Alert>}
 </section></BackofficeShell></ProtectedRoute>;
}
export default function ClientPortalPreview(){return <Suspense fallback={<p>Conferindo acesso…</p>}><Preview/></Suspense>;}
