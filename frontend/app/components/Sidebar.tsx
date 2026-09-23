'use client';

import Link from 'next/link';
import {
  BarChart3,
  LogOut,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/app/components/ui';

export default function Sidebar() {
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_email');

    router.replace('/auth/login');
  };

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
            Backoffice
          </p>
        </div>
      </header>

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
