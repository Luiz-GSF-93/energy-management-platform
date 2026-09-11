"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  Menu,
  X,
  Bell,
  LayoutDashboard,
  Users,
  FileText,
  DollarSign,
  CheckCircle,
  BarChart3,
  ChevronRight,
  Zap,
} from 'lucide-react';

interface BackofficeNavItem {
  icon: any;
  label: string;
  href: string;
  id: string;
  adminOnly?: boolean;
}

const navItems: BackofficeNavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/backoffice/dashboard', id: 'dashboard' },
  { icon: Users, label: 'Usuários', href: '/backoffice/users', id: 'users', adminOnly: true },
  { icon: FileText, label: 'Contratos', href: '/backoffice/contracts', id: 'contracts' },
  { icon: DollarSign, label: 'Honorários', href: '/backoffice/fees', id: 'fees' },
  { icon: CheckCircle, label: 'Aprovações', href: '/backoffice/approvals', id: 'approvals' },
  { icon: BarChart3, label: 'Relatórios', href: '/backoffice/reports', id: 'reports' },
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
    
    // Obter role do token (decodificado)
    const token = localStorage.getItem('auth_token');
    if (!token) {
      router.push('/auth/login');
      return;
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      setUserRole(payload.role || 'CLIENT');
    } catch (e) {
      console.error('Erro ao decodificar token:', e);
      setUserRole('CLIENT');
    }

    const path = window.location.pathname.split('/').pop() || 'dashboard';
    const navItem = navItems.find(item => item.href.includes(path));
    if (navItem) setActiveNav(navItem.id);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    router.push('/auth/login');
  };

  if (!mounted) return null;

  // Filtrar itens do menu baseado no role
  const filteredNavItems = navItems.filter(item => {
    if (item.adminOnly && userRole !== 'ADMIN') {
      return false;
    }
    return true;
  });

  return (
    <div className="flex min-h-screen bg-gray-950">
      {/* Sidebar - Mesmo do Dashboard */}
      <aside className={`${
        sidebarOpen ? 'w-64' : 'w-20'
      } bg-gradient-to-b from-gray-900 to-gray-800 border-r border-gray-700 transition-all duration-300 flex flex-col`}>
        {/* Logo */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          {sidebarOpen && (
            <div className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-blue-400" />
              <span className="text-lg font-bold text-white">Expert</span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {filteredNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={item.href}
                onClick={() => setActiveNav(item.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  activeNav === item.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-gray-700 transition-all"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span className="text-sm font-medium">Sair</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <header className="bg-gradient-to-r from-gray-900 to-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-700 rounded-lg lg:hidden transition-colors"
          >
            <Menu className="w-6 h-6 text-gray-300" />
          </button>

          <div className="flex items-center gap-4">
            <button className="relative p-2 hover:bg-gray-700 rounded-lg transition-colors">
              <Bell className="w-6 h-6 text-gray-300" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>

            <div className="flex items-center gap-3 pl-4 border-l border-gray-700">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">BO</span>
              </div>
              <div className="hidden md:block">
                <p className="text-sm font-medium text-white">Backoffice</p>
                <p className="text-xs text-gray-400 capitalize">{userRole?.toLowerCase() || 'Usuario'}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
