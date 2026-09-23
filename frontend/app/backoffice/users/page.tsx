'use client';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  Alert,
  Button,
} from '@/app/components/ui';
import BackofficeShell from '@/app/components/BackofficeShell';
import {
  ApiError,
  getUsers,
  type OrganizationUser,
} from '@/app/lib/api';
import {
  ORGANIZATION_PERMISSIONS,
} from '@/app/lib/permissions';
import { useAuth } from '@/app/providers';

function affiliationLabel(
  affiliation: OrganizationUser['affiliationType'],
): string {
  return affiliation === 'internal'
    ? 'Interno'
    : 'Externo';
}

function membershipLabel(
  status: string,
): string {
  if (status === 'active') {
    return 'Ativo';
  }

  if (status === 'inactive') {
    return 'Inativo';
  }

  return status;
}

export default function UsersPage() {
  const {
    context,
    hasPermission,
  } = useAuth();

  const [users, setUsers] =
    useState<OrganizationUser[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const organizationContext =
    context && context.scope !== 'global'
      ? context
      : null;

  const canView =
    Boolean(organizationContext) &&
    hasPermission(
      ORGANIZATION_PERMISSIONS.USERS_VIEW,
    );

  const loadUsers = useCallback(
    async () => {
      if (!canView) {
        setUsers([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const result = await getUsers();
        setUsers(result);
      } catch (loadError) {
        setError(
          loadError instanceof ApiError
            ? loadError.message
            : 'Não foi possível carregar os usuários.',
        );
      } finally {
        setLoading(false);
      }
    },
    [canView],
  );

  useEffect(() => {
    if (!canView) {
      return;
    }

    let cancelled = false;

    getUsers()
      .then((result) => {
        if (!cancelled) {
          setUsers(result);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof ApiError
              ? loadError.message
              : 'Não foi possível carregar os usuários.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canView]);

  return (
    <BackofficeShell>
      <main className="users-page">
        <header className="users-page__header">
          <div>
            <p className="users-page__eyebrow">
              Administração
            </p>

            <h1>Usuários</h1>

            <p className="users-page__description">
              Usuários vinculados à organização ativa.
            </p>
          </div>

          {canView ? (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() =>
                void loadUsers()
              }
            >
              Atualizar
            </Button>
          ) : null}
        </header>

        {!organizationContext ? (
          <Alert variant="error">
            O gerenciamento de usuários requer
            um contexto organizacional ativo.
          </Alert>
        ) : !canView ? (
          <Alert variant="error">
            Você não possui permissão para
            visualizar usuários desta organização.
          </Alert>
        ) : loading ? (
          <section
            className="users-state"
            aria-live="polite"
          >
            Carregando usuários...
          </section>
        ) : error ? (
          <Alert variant="error">
            {error}
          </Alert>
        ) : users.length === 0 ? (
          <section className="users-state">
            Nenhum usuário encontrado nesta
            organização.
          </section>
        ) : (
          <section
            className="users-grid"
            aria-label="Usuários da organização"
          >
            {users.map((user) => (
              <article
                className="users-card"
                key={user.userId}
              >
                <div className="users-card__identity">
                  <h2>
                    {user.name || user.email}
                  </h2>

                  {user.name ? (
                    <p>{user.email}</p>
                  ) : null}
                </div>

                <dl className="users-card__details">
                  <div>
                    <dt>Função</dt>
                    <dd>{user.role.name}</dd>
                  </div>

                  <div>
                    <dt>Vínculo</dt>
                    <dd>
                      {affiliationLabel(
                        user.affiliationType,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>Status</dt>
                    <dd>
                      {membershipLabel(
                        user.membershipStatus,
                      )}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </section>
        )}
      </main>
    </BackofficeShell>
  );
}
