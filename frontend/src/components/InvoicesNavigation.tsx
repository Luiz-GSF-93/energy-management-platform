'use client';

import Link from 'next/link';
import { FileText, List, TrendingUp, BarChart3, Eye, Download } from 'lucide-react';
import { usePathname } from 'next/navigation';

export default function InvoicesNavigation() {
  const pathname = usePathname();

  const navItems = [
    { href: '/backoffice/invoices', label: 'Faturas', icon: List },
    { href: '/backoffice/invoices/dashboard', label: 'Dashboard', icon: BarChart3 },
    { href: '/backoffice/invoices/simulation', label: 'Simulação', icon: TrendingUp },
    { href: '/backoffice/invoices/audit', label: 'Auditoria', icon: Eye },
    { href: '/backoffice/invoices/report', label: 'Relatórios', icon: Download },
  ];

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 mb-6">
      <div className="flex flex-wrap gap-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
