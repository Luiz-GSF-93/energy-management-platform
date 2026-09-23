'use client';

import {
  ReactNode,
  useEffect,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  ErrorState,
  LoadingState,
} from '@/app/components/ui';
import { useAuth } from '@/app/providers';

interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({
  children,
}: ProtectedRouteProps) {
  const router = useRouter();

  const {
    status,
    refresh,
  } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/login');
    }
  }, [router, status]);

  if (status === 'error') {
    return (
      <div>
        <ErrorState
          title="Não foi possível validar a sessão"
          description={
            'O serviço de autenticação não respondeu ' +
            'corretamente. Sua sessão não foi descartada.'
          }
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <Button
            variant="secondary"
            onClick={() => {
              void refresh();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return (
      <LoadingState
        title={
          status === 'loading'
            ? 'Validando acesso...'
            : 'Redirecionando...'
        }
        description={
          status === 'loading'
            ? 'Validando identidade, organização e permissões.'
            : 'Sessão não autenticada.'
        }
      />
    );
  }

  return <>{children}</>;
}
