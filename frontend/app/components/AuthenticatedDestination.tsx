'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/providers';
import { apiRequest } from '@/app/lib/api/client';
import { normalizeAuthContext } from '@/app/lib/auth/organization-context';
import { Alert, Button, LoadingState } from '@/app/components/ui';

// Login and MFA use the same server-derived audience; no email or URL overrides.
export default function AuthenticatedDestination() {
  const { context, logout } = useAuth(), router = useRouter();
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        if (!context) throw new Error('Contexto de acesso indisponível. Entre novamente.');
        const current = normalizeAuthContext(context);
        if (current.scope === 'global' || current.accessMode === 'platform_operation' ||
            current.currentOrganization.role !== 'consulta') {
          if (!abort.signal.aborted) router.replace('/backoffice/dashboard');
          return;
        }
        const access = await apiRequest<{organizationId: string; audience: string}>(
          '/api/v1/portal/access', { cache: 'no-store', signal: abort.signal });
        if (access.organizationId !== current.currentOrganization.id ||
            !['client', 'backoffice'].includes(access.audience)) {
          throw new Error('O contexto de acesso mudou. Confira seu acesso novamente.');
        }
        if (!abort.signal.aborted) router.replace(access.audience === 'client' ? '/portal' : '/backoffice/dashboard');
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Não foi possível conferir seu ambiente.');
      }
    })();
    return () => abort.abort();
  }, [context, router, revision]);
  return <main className="auth-page"><div className="auth-card">{error ? <>
    <Alert variant="error">{error}</Alert>
    <Button onClick={() => { setError(''); setRevision(v => v + 1); }}>Conferir acesso novamente</Button>
    <Button variant="secondary" onClick={() => { logout(); router.replace('/auth/login'); }}>Entrar com outra conta</Button>
  </> : <LoadingState title="Abrindo seu ambiente EnergyOS" description="Conferindo seu vínculo e suas permissões."/>}</div></main>;
}
