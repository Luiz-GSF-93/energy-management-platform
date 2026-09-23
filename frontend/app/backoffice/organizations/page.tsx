'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';

import BackofficeShell from '@/app/components/BackofficeShell';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
} from '@/app/components/ui';
import {
  ApiError,
  createOrganization,
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

  const [name, setName] = useState('');

  const [description, setDescription] =
    useState('');

  const [submitting, setSubmitting] =
    useState(false);

  const [createError, setCreateError] =
    useState('');

  const [createSuccess, setCreateSuccess] =
    useState('');

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

  const canCreate = hasPermission(
    PLATFORM_PERMISSIONS.ORGANIZATIONS_CREATE,
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

  const handleCreate = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const normalizedName = name.trim();
    const normalizedDescription =
      description.trim();

    if (!normalizedName) {
      setCreateError(
        'Informe o nome da organização.',
      );
      setCreateSuccess('');
      return;
    }

    setSubmitting(true);
    setCreateError('');
    setCreateSuccess('');

    try {
      await createOrganization({
        name: normalizedName,
        ...(normalizedDescription
          ? {
              description:
                normalizedDescription,
            }
          : {}),
      });

      setName('');
      setDescription('');

      setCreateSuccess(
        'Organização criada com sucesso.',
      );

      await loadOrganizations();
    } catch (error) {
      setCreateError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível criar a organização.',
      );
    } finally {
      setSubmitting(false);
    }
  };

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

        {canCreate ? (
          <Card>
            <div className="organizations-create">
              <div>
                <h2>Nova organização</h2>

                <p className="organizations-page__description">
                  Cadastre uma nova organização
                  na plataforma.
                </p>
              </div>

              <form
                className="organizations-create__form"
                onSubmit={handleCreate}
              >
                {createError ? (
                  <Alert variant="error">
                    {createError}
                  </Alert>
                ) : null}

                {createSuccess ? (
                  <Alert>
                    {createSuccess}
                  </Alert>
                ) : null}

                <Input
                  label="Nome"
                  name="name"
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  required
                  disabled={submitting}
                  autoComplete="organization"
                />

                <div className="ds-field">
                  <label
                    className="ds-label"
                    htmlFor="organization-description"
                  >
                    Descrição
                  </label>

                  <textarea
                    id="organization-description"
                    name="description"
                    className="ds-input organizations-create__description"
                    value={description}
                    onChange={(event) =>
                      setDescription(
                        event.target.value,
                      )
                    }
                    disabled={submitting}
                    rows={4}
                  />
                </div>

                <div className="organizations-create__actions">
                  <Button
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting
                      ? 'Criando...'
                      : 'Criar organização'}
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        ) : null}

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
