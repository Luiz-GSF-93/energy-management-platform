'use client';

import Link from 'next/link';
import {
  BarChart3,
  LogOut,
} from 'lucide-react';
import {
  ChangeEvent,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  Alert,
  Button,
} from '@/app/components/ui';
import { useAuth } from '@/app/providers';

export default function Sidebar() {
  const router = useRouter();

  const {
    context,
    logout,
    switchOrganization,
  } = useAuth();

  const [switching, setSwitching] =
    useState(false);
  const [switchError, setSwitchError] =
    useState('');

  const handleLogout = () => {
    logout();
    router.replace('/auth/login');
  };

  const handleOrganizationChange = async (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const organizationId =
      event.target.value;

    if (
      !context ||
      organizationId ===
        context.currentOrganization.id
    ) {
      return;
    }

    setSwitching(true);
    setSwitchError('');

    try {
      await switchOrganization(
        organizationId,
      );
    } catch {
      setSwitchError(
        'Não foi possível trocar de organização.',
      );
    } finally {
      setSwitching(false);
    }
  };

  const organizations =
    context?.organizations ?? [];

  return (
    <aside className="backoffice-sidebar">
      <header className="backoffice-brand">
        <div
          className="backoffice-brand__mark"
          aria-hidden="true"
        >
          EE
        </div>

        <div>
          <h1 className="backoffice-brand__name">
            Expert Energy
          </h1>

          <p className="backoffice-brand__context">
            {context
              ? `Perfil: ${context.currentOrganization.role}`
              : 'Backoffice'}
          </p>
        </div>
      </header>

      {context && organizations.length > 1 ? (
        <div className="backoffice-context">
          <label
            className="backoffice-context__label"
            htmlFor="organization-context"
          >
            Organização ativa
          </label>

          <select
            id="organization-context"
            className="backoffice-context__select"
            value={
              context.currentOrganization.id
            }
            onChange={
              handleOrganizationChange
            }
            disabled={switching}
          >
            {organizations.map(
              (organization) => (
                <option
                  key={organization.id}
                  value={organization.id}
                >
                  {`Organização ${organization.id.slice(0, 8)} — ${organization.role}`}
                </option>
              ),
            )}
          </select>

          {switchError ? (
            <Alert variant="error">
              {switchError}
            </Alert>
          ) : null}
        </div>
      ) : null}

      <nav
        className="backoffice-nav"
        aria-label="Administração"
      >
        <Link
          href="/backoffice/dashboard"
          className="backoffice-nav__link"
        >
          <BarChart3
            size={20}
            className="backoffice-nav__icon"
            aria-hidden="true"
          />

          <span>Dashboard</span>
        </Link>
      </nav>

      <footer className="backoffice-sidebar__footer">
        <Button
          variant="danger"
          onClick={handleLogout}
        >
          <LogOut
            size={20}
            aria-hidden="true"
          />

          Sair
        </Button>
      </footer>
    </aside>
  );
}
