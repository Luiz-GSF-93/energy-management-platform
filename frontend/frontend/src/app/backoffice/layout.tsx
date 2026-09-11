'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, LogOut, Settings, FileText, DollarSign, CheckCircle, BarChart3, Home, Users as UsersIcon, Receipt } from 'lucide-react';

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [userName, setUserName] = useState('Admin');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const token = localStorage.getItem('auth_token');
    const name = localStorage.getItem('user_name');
    
    if (!token) {
      router.push('/auth/login');
      return;
    }
    
    setUserName(name || 'Admin');
    
    const path = window.location.pathname;
    if (path.includes('/backoffice/contracts')) setActiveNav('contracts');
    else if (path.includes('/backoffice/invoices')) setActiveNav('invoices');
    else if (path.includes('/backoffice/approvals')) setActiveNav('approvals');
    else if (path.includes('/backoffice/reports')) setActiveNav('reports');
    else if (path.includes('/backoffice/users')) setActiveNav('users');
    else if (path.includes('/backoffice/settings')) setActiveNav('settings');
    else setActiveNav('dashboard');
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_name');
    router.push('/auth/login');
  };

  const navItems = [
    { icon: Home, label: 'Dashboard', href: '/backoffice', id: 'dashboard' },
    { icon: FileText, label: 'Contratos', href: '/backoffice/contracts', id: 'contracts' },
    { icon: Receipt, label: 'Faturas', href: '/backoffice/invoices', id: 'invoices' },
    { icon: CheckCircle, label: 'Aprovações', href: '/backoffice/approvals', id: 'approvals' },
    { icon: UsersIcon, label: 'Usuários', href: '/backoffice/users', id: 'users' },
    { icon: BarChart3, label: 'Relatórios', href: '/backoffice/reports', id: 'reports' },
    { icon: Settings, label: 'Configurações', href: '/backoffice/settings', id: 'settings' },
  ];

  if (!isClient) return null;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className={`fixed left-0 top-0 h-full bg-gray-950 border-r border-gray-800 transition-all ${sidebarOpen ? 'w-64' : 'w-20'} z-50`}>
        <div className="h-20 bg-orange-600 flex items-center justify-center border-b border-gray-800">
          <span className={`font-bold text-xl ${sidebarOpen ? '' : 'text-sm'}`}>EE</span>
        </div>

        <nav className="p-4 space-y-2">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={item.href}
              onClick={() => setActiveNav(item.id)}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all ${
                activeNav === item.id
                  ? 'bg-orange-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800'
              }`}
            >
              <item.icon size={20} />
              {sidebarOpen && <span>{item.label}</span>}
            </a>
          ))}
        </nav>

        <div className="absolute bottom-6 left-0 right-0 px-4">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-lg text-gray-400 hover:bg-gray-800 transition-all"
          >
            <LogOut size={20} />
            {sidebarOpen && <span>Sair</span>}
          </button>
        </div>
      </div>

      <div className={`transition-all ${sidebarOpen ? 'ml-64' : 'ml-20'}`}>
        <div className="h-20 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-400 hover:text-white"
          >
            <Menu size={24} />
          </button>
          <div className="text-sm text-gray-400">
            Bem-vindo, {userName}
          </div>
        </div>

        <div className="bg-gray-900 min-h-[calc(100vh-80px)]">
          {children}
        </div>
      </div>
    </div>
  );
}
