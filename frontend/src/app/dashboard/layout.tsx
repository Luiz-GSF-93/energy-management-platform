'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, LogOut, Settings, CreditCard, TrendingDown, Zap, BarChart3, Brain } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeNav, setActiveNav] = useState('dashboard');
  const [userName, setUserName] = useState('Cliente');

  useEffect(() => {
    // Só executar no cliente
    const token = localStorage.getItem('auth_token');
    const name = localStorage.getItem('user_name');
    
    if (!token) {
      router.push('/auth/login');
      return;
    }
    
    setUserName(name || 'Cliente');
    
    const path = window.location.pathname;
    if (path.includes('/dashboard/invoices')) setActiveNav('invoices');
    else if (path.includes('/dashboard/analysis')) setActiveNav('analysis');
    else if (path.includes('/dashboard/savings')) setActiveNav('savings');
    else if (path.includes('/dashboard/settings')) setActiveNav('settings');
    else setActiveNav('dashboard');
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_name');
    router.push('/auth/login');
  };

  const navItems = [
    { icon: BarChart3, label: 'Dashboard', href: '/dashboard', id: 'dashboard' },
    { icon: CreditCard, label: 'Minhas Faturas', href: '/dashboard/invoices', id: 'invoices' },
    { icon: TrendingDown, label: 'Minha Análise', href: '/dashboard/analysis', id: 'analysis' },
    { icon: Zap, label: 'Economia', href: '/dashboard/savings', id: 'savings' },
    { icon: Brain, label: 'IA', href: '/dashboard/ai', id: 'ai', disabled: true },
    { icon: Settings, label: 'Configurações', href: '/dashboard/settings', id: 'settings' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100">
      {/* Sidebar */}
      <div className={`fixed left-0 top-0 h-full bg-white border-r border-blue-200 shadow-lg transition-all ${sidebarOpen ? 'w-64' : 'w-20'} z-50`}>
        {/* Logo */}
        <div className="h-20 bg-blue-600 flex items-center justify-center border-b border-blue-200">
          <span className={`font-bold text-xl text-white ${sidebarOpen ? '' : 'text-sm'}`}>EE</span>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={item.disabled ? '#' : item.href}
              onClick={(e) => {
                if (item.disabled) e.preventDefault();
                else setActiveNav(item.id);
              }}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all ${
                item.disabled
                  ? 'text-gray-300 cursor-not-allowed'
                  : activeNav === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-blue-50'
              }`}
            >
              <item.icon size={20} />
              {sidebarOpen && <span>{item.label}</span>}
            </a>
          ))}
        </nav>

        {/* Logout */}
        <div className="absolute bottom-6 left-0 right-0 px-4">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-lg text-gray-600 hover:bg-blue-50 transition-all"
          >
            <LogOut size={20} />
            {sidebarOpen && <span>Sair</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className={`transition-all ${sidebarOpen ? 'ml-64' : 'ml-20'}`}>
        {/* Header */}
        <div className="h-20 bg-white border-b border-blue-200 shadow-sm flex items-center justify-between px-6">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-blue-600 hover:text-blue-700"
          >
            <Menu size={24} />
          </button>
          <div className="text-sm text-gray-600">
            Bem-vindo, {userName}
          </div>
        </div>

        {/* Page Content */}
        <div className="min-h-[calc(100vh-80px)] p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
