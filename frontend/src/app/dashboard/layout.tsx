'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  LogOut,
  Menu,
  X,
  Bell,
  Home,
  ReceiptText,
  Brain,
  TrendingUp,
  Cog,
  ChevronRight,
  Zap,
} from 'lucide-react';

const navItems = [
  { icon: Home, label: 'Dashboard', href: '/dashboard', id: 'dashboard' },
  { icon: ReceiptText, label: 'Faturas', href: '/dashboard/invoices', id: 'invoices' },
  { icon: Brain, label: 'Análise', href: '/dashboard/analysis', id: 'analysis' },
  { icon: TrendingUp, label: 'Economia', href: '/dashboard/savings', id: 'savings' },
  { icon: Cog, label: 'Configurações', href: '/dashboard/settings', id: 'settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [notificationCount, setNotificationCount] = useState(2);

  const handleLogout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    router.push('/auth/login');
  };

  const getCurrentPageLabel = () => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const item = navItems.find(n => n.href === path);
      return item?.label || 'Dashboard';
    }
    return 'Dashboard';
  };

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 h-full w-64 bg-gradient-to-b from-gray-900/90 to-gray-950 backdrop-blur-md border-r border-white/10 transition-transform duration-300 z-40 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="p-6 border-b border-white/10">
          <Link href="/dashboard">
            <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-white text-lg">Energy</span>
            </div>
          </Link>
          <p className="text-gray-400 text-xs mt-1">Gerenciamento Inteligente</p>
        </div>

        {/* Navigation */}
        <nav className="p-4 flex-1">
          {navItems.map((item) => {
            const isActive =
              typeof window !== 'undefined' &&
              window.location.pathname === item.href;
            return (
              <Link key={item.label} href={item.href}>
                <div
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 cursor-pointer transition-all duration-200 ${
                    isActive
                      ? 'bg-gradient-to-r from-orange-500/30 to-red-600/20 border-l-2 border-orange-500 text-white'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                  {isActive && <ChevronRight className="w-4 h-4 ml-auto" />}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sair</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div
        className={`flex-1 flex flex-col ${sidebarOpen ? 'ml-64' : 'ml-0'} transition-all duration-300`}
      >
        {/* Top Bar */}
        <div className="sticky top-0 z-30 bg-gradient-to-b from-gray-900/80 to-gray-950/50 backdrop-blur-md border-b border-white/10">
          <div className="flex items-center justify-between px-8 py-4">
            {/* Left */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <h1 className="text-2xl font-bold text-white hidden sm:block">
                {getCurrentPageLabel()}
              </h1>
            </div>

            {/* Right */}
            <div className="flex items-center gap-6">
              {/* Notifications */}
              <div className="relative">
                <button className="p-2 hover:bg-white/10 rounded-lg transition-colors relative">
                  <Bell className="w-5 h-5 text-gray-400 hover:text-white" />
                  {notificationCount > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                  )}
                </button>
              </div>

              {/* User Menu */}
              <div className="flex items-center gap-3 pl-6 border-l border-white/10">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold">
                  U
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-semibold text-white">Usuário</p>
                  <p className="text-xs text-gray-400">Premium</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Page Content - com background escuro */}
        <div className="flex-1 overflow-auto bg-gray-950">
          {children}
        </div>
      </div>
    </div>
  );
}
