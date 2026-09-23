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
  deleteOrganization,
  getOrganizations,
  updateOrganization,
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

  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [editName, setEditName] =
    useState('');

  const [editDescription, setEditDescription] =
    useState('');

  const [updateSubmitting, setUpdateSubmitting] =
    useState(false);

  const [updateError, setUpdateError] =
    useState('');

  const [deleteTarget, setDeleteTarget] =
    useState<Organization | null>(null);

  const [deleteSubmitting, setDeleteSubmitting] =
    useState(false);

  const [deleteError, setDeleteError] =
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

  const canUpdate = hasPermission(
    PLATFORM_PERMISSIONS.ORGANIZATIONS_UPDATE,
  );

  const canDelete = hasPermission(
    PLATFORM_PERMISSIONS.ORGANIZATIONS_DELETE,
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

  const startEditing = (
    organization: Organization,
  ) => {
    setEditingId(organization.id);
    setEditName(organization.name);
    setEditDescription(
      organization.description ?? '',
    );
    setUpdateError('');
  };

  const cancelEditing = () => {
    if (updateSubmitting) {
      return;
    }

    setEditingId(null);
    setEditName('');
    setEditDescription('');
    setUpdateError('');
  };

  const handleUpdate = async (
    event: FormEvent<HTMLFormElement>,
    organization: Organization,
  ) => {
    event.preventDefault();

    const normalizedName = editName.trim();
    const normalizedDescription =
      editDescription.trim();

    if (!normalizedName) {
      setUpdateError(
        'Informe o nome da organização.',
      );
      return;
    }

    const currentDescription =
      organization.description ?? '';

    const input: {
      name?: string;
      description?: string;
    } = {};

    if (
      normalizedName !==
      organization.name
    ) {
      input.name = normalizedName;
    }

    if (
      normalizedDescription !==
      currentDescription
    ) {
      input.description =
        normalizedDescription;
    }

    if (Object.keys(input).length === 0) {
      setEditingId(null);
      setUpdateError('');
      return;
    }

    setUpdateSubmitting(true);
    setUpdateError('');

    try {
      await updateOrganization(
        organization.id,
        input,
      );

      setEditingId(null);
      setEditName('');
      setEditDescription('');

      await loadOrganizations();
    } catch (error) {
      setUpdateError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível atualizar a organização.',
      );
    } finally {
      setUpdateSubmitting(false);
    }
  };

  const requestDelete = (
    organization: Organization,
  ) => {
    setDeleteTarget(organization);
    setDeleteError('');
  };

  const cancelDelete = () => {
    if (deleteSubmitting) {
      return;
    }

    setDeleteTarget(null);
    setDeleteError('');
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    setDeleteSubmitting(true);
    setDeleteError('');

    try {
      await deleteOrganization(
        deleteTarget.id,
      );

      setDeleteTarget(null);

      await loadOrganizations();
    } catch (error) {
      setDeleteError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível excluir a organização.',
      );
    } finally {
      setDeleteSubmitting(false);
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
                  {editingId ===
                  organization.id ? (
                    <form
                      className="organizations-edit"
                      onSubmit={(event) =>
                        void handleUpdate(
                          event,
                          organization,
                        )
                      }
                    >
                      {updateError ? (
                        <Alert variant="error">
                          {updateError}
                        </Alert>
                      ) : null}

                      <Input
                        label="Nome"
                        value={editName}
                        onChange={(event) =>
                          setEditName(
                            event.target.value,
                          )
                        }
                        required
                        disabled={
                          updateSubmitting
                        }
                      />

                      <div className="ds-field">
                        <label
                          className="ds-label"
                          htmlFor={`organization-edit-description-${organization.id}`}
                        >
                          Descrição
                        </label>

                        <textarea
                          id={`organization-edit-description-${organization.id}`}
                          className="ds-input organizations-edit__description"
                          value={editDescription}
                          onChange={(event) =>
                            setEditDescription(
                              event.target.value,
                            )
                          }
                          disabled={
                            updateSubmitting
                          }
                          rows={4}
                        />
                      </div>

                      <div className="organizations-edit__actions">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={
                            updateSubmitting
                          }
                          onClick={
                            cancelEditing
                          }
                        >
                          Cancelar
                        </Button>

                        <Button
                          type="submit"
                          disabled={
                            updateSubmitting
                          }
                        >
                          {updateSubmitting
                            ? 'Salvando...'
                            : 'Salvar alterações'}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
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
                          <dd>
                            {organization.id}
                          </dd>
                        </div>
                      </dl>

                      {canUpdate || canDelete ? (
                        <div className="organizations-card__actions">
                          {canUpdate ? (
                            <Button
                              variant="secondary"
                              onClick={() =>
                                startEditing(
                                  organization,
                                )
                              }
                            >
                              Editar
                            </Button>
                          ) : null}

                          {canDelete ? (
                            <Button
                              variant="danger"
                              onClick={() =>
                                requestDelete(
                                  organization,
                                )
                              }
                            >
                              Excluir
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </Card>
              ),
            )}
          </div>
        )}
      </div>
      {deleteTarget ? (
        <div
          className="organizations-delete-overlay"
          role="presentation"
        >
          <div
            className="organizations-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="organization-delete-title"
          >
            <h2 id="organization-delete-title">
              Excluir organização?
            </h2>

            <p>
              Você está prestes a excluir
              <strong>
                {' '}
                {deleteTarget.name}
              </strong>
              .
            </p>

            <p>
              A operação será bloqueada pelo
              servidor se existirem dependências
              vinculadas à organização.
            </p>

            {deleteError ? (
              <Alert variant="error">
                {deleteError}
              </Alert>
            ) : null}

            <div className="organizations-delete-dialog__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={deleteSubmitting}
                onClick={cancelDelete}
              >
                Cancelar
              </Button>

              <Button
                type="button"
                variant="danger"
                disabled={deleteSubmitting}
                onClick={() =>
                  void handleDelete()
                }
              >
                {deleteSubmitting
                  ? 'Excluindo...'
                  : 'Confirmar exclusão'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </BackofficeShell>
  );
}
