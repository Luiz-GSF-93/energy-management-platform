'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Users,
  FileText,
  CheckCircle,
  Settings,
  LogOut,
  Menu,
} from 'lucide-react';
import { useState } from 'react';

export default function BackofficeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    router.push('/auth/login');
  };

  const menuItems = [
    {
      label: 'Dashboard',
      href: '/backoffice/dashboard',
      icon: BarChart3,
    },
    {
      label: 'Usuários',
      href: '/backoffice/users',
      icon: Users,
    },
    {
      label: 'Contratos',
      href: '/backoffice/contracts',
      icon: FileText,
    },
    {
      label: 'Honorários',
      href: '/backoffice/fees',
      icon: FileText,
    },
    {
      label: 'Aprovações',
      href: '/backoffice/approvals',
      icon: CheckCircle,
    },
    {
      label: 'Relatórios',
      href: '/backoffice/reports',
      icon: BarChart3,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Top Bar */}
      <div className="fixed top-0 left-0 right-0 bg-slate-900 border-b border-slate-800 px-6 py-4 z-40">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-slate-400 hover:text-white transition"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h1 className="text-2xl font-bold text-white">
              Expert Energy - Backoffice
            </h1>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-16 bottom-0 bg-slate-900 border-r border-slate-800 w-64 transition-transform duration-300 z-30 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <nav className="p-6 space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition group"
              >
                <Icon className="w-5 h-5 group-hover:text-blue-500 transition" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <main className={`pt-20 transition-all duration-300 ${sidebarOpen ? 'ml-64' : 'ml-0'}`}>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
