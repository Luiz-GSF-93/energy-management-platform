"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  Menu,
  X,
  Bell,
  Home,
  Receipt,
  Brain,
  TrendingUp,
  Cog,
  FileText,
  CheckCircle,
  DollarSign,
} from 'lucide-react';

const navItems = [
  { icon: Home, label: 'Dashboard', href: '/backoffice/dashboard', id: 'dashboard' },
  { icon: FileText, label: 'Contratos', href: '/backoffice/contracts', id: 'contracts' },
  { icon: Receipt, label: 'Faturas', href: '/backoffice/invoices', id: 'invoices' },
  { icon: DollarSign, label: 'Taxas', href: '/backoffice/fees', id: 'fees' },
  { icon: CheckCircle, label: 'Aprovações', href: '/backoffice/approvals', id: 'approvals' },
  { icon: TrendingUp, label: 'Relatórios', href: '/backoffice/reports', id: 'reports' },
  { icon: Cog, label: 'Configurações', href: '/backoffice/settings', id: 'settings' },
];

export default function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [mounted, setMounted] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const role = localStorage.getItem('user_role');
    setUserRole(role);

    // Se não for admin/backoffice, redirecionar para cliente
    if (role && !['ADMIN', 'BACKOFFICE_MANAGER', 'BACKOFFICE_ANALYST'].includes(role)) {
      router.push('/dashboard');
    }

    const path = window.location.pathname.split('/').pop() || 'dashboard';
    const navItem = navItems.find(item => item.href.includes(path));
    if (navItem) setActiveNav(navItem.id);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('tenant_id');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_name');
    router.push('/auth/login');
  };

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 overflow-y-auto`}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <FileText className="w-6 h-6 text-orange-600" />
              <span className="font-bold text-gray-900 dark:text-white">Backoffice</span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveNav(item.id);
                  router.push(item.href);
                }}
                className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg transition ${
                  isActive
                    ? 'bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon size={20} className="flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <p>Role: {userRole}</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
            {navItems.find(item => item.id === activeNav)?.label || 'Backoffice'}
          </h1>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              <Bell size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <LogOut size={20} />
              <span className="text-sm font-medium">Sair</span>
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
