'use client';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import BackofficeShell from '@/app/components/BackofficeShell';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/app/components/ui';
import {
  ApiError,
  getOrganizations,
} from '@/app/lib/api';
import type {
  Organization,
} from '@/app/lib/api';
import { PLATFORM_PERMISSIONS } from '@/app/lib/permissions';
import { useAuth } from '@/app/providers';

type OrganizationsStatus =
  | 'loading'
  | 'ready'
  | 'error';

export default function OrganizationsPage() {
  const {
    hasPermission,
  } = useAuth();

  const [organizations, setOrganizations] =
    useState<Organization[]>([]);

  const [status, setStatus] =
    useState<OrganizationsStatus>('loading');

  const [errorMessage, setErrorMessage] =
    useState(
      'Não foi possível carregar as organizações.',
    );

  const canView = hasPermission(
    PLATFORM_PERMISSIONS.ORGANIZATIONS_VIEW,
  );

  const loadOrganizations =
    useCallback(async () => {
      setStatus('loading');

      try {
        const result =
          await getOrganizations();

        setOrganizations(result);
        setStatus('ready');
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 ||
            error.status === 403)
        ) {
          setErrorMessage(
            'Seu acesso não permite consultar organizações.',
          );
        } else {
          setErrorMessage(
            'Não foi possível carregar as organizações.',
          );
        }

        setStatus('error');
      }
    }, []);

  useEffect(() => {
    if (!canView) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadOrganizations();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [canView, loadOrganizations]);

  if (!canView) {
    return (
      <BackofficeShell>
        <ErrorState
          title="Acesso não autorizado"
          description={
            'Seu perfil não possui permissão para consultar organizações.'
          }
        />
      </BackofficeShell>
    );
  }

  if (status === 'loading') {
    return (
      <BackofficeShell>
        <LoadingState
          title="Carregando organizações..."
          description={
            'Consultando o cadastro administrativo.'
          }
        />
      </BackofficeShell>
    );
  }

  if (status === 'error') {
    return (
      <BackofficeShell>
        <ErrorState
          title="Falha ao carregar organizações"
          description={errorMessage}
        />
      </BackofficeShell>
    );
  }

  return (
    <BackofficeShell>
      <div className="organizations-page">
        <header className="organizations-page__header">
          <div>
            <p className="organizations-page__eyebrow">
              Administração
            </p>

            <h1>Organizações</h1>

            <p className="organizations-page__description">
              Consulte as organizações cadastradas na
              plataforma.
            </p>
          </div>
        </header>

        {organizations.length === 0 ? (
          <EmptyState
            title="Nenhuma organização encontrada"
            description={
              'Não há organizações disponíveis para consulta.'
            }
          />
        ) : (
          <div className="organizations-grid">
            {organizations.map(
              (organization) => (
                <Card
                  key={organization.id}
                  title={organization.name}
                >
                  {organization.description ? (
                    <p className="organizations-card__description">
                      {organization.description}
                    </p>
                  ) : (
                    <p className="organizations-card__description organizations-card__description--muted">
                      Sem descrição cadastrada.
                    </p>
                  )}

                  <dl className="organizations-card__meta">
                    <div>
                      <dt>Identificador</dt>
                      <dd>{organization.id}</dd>
                    </div>
                  </dl>
                </Card>
              ),
            )}
          </div>
        )}
      </div>
    </BackofficeShell>
  );
}
