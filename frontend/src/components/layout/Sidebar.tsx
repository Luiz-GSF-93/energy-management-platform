'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileText, Settings, Home, TrendingUp } from 'lucide-react';

export function Sidebar() {
  const pathname = usePathname();

  const menuItems = [
    { href: '/dashboard', label: 'Dashboard', icon: Home },
    { href: '/dashboard/invoices', label: 'Faturas', icon: FileText },
    { href: '/dashboard/savings', label: 'Economia', icon: TrendingUp },
    { href: '/dashboard/analysis', label: 'Análise', icon: BarChart3 },
    { href: '/dashboard/settings', label: 'Configurações', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-gray-900 text-white h-screen p-6 space-y-8">
      <div>
        <h2 className="text-xl font-bold">Menu</h2>
      </div>
      <nav className="space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
