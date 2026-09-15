'use client';

import Link from 'next/link';
import { LogOut, BarChart3, FileText, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function Sidebar() {
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_email');
    router.push('/auth/login');
  };

  return (
    <div className="w-64 h-screen bg-gradient-to-b from-[#1a1f2e] to-[#0f172a] border-r border-[#59cbe8]/20 flex flex-col p-6">
      <div className="mb-8 pb-6 border-b border-[#59cbe8]/20">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#59cbe8] to-[#00d4ff] flex items-center justify-center text-white font-bold">
            EE
          </div>
          <h1 className="text-xl font-bold text-[#59cbe8]">Expert Energy</h1>
        </div>
        <p className="text-xs text-[#cbd5e1]">Backoffice</p>
      </div>

      <nav className="flex-1 space-y-2">
        <Link href="/backoffice/dashboard" className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-[#59cbe8]/10 text-[#f1f5f9] transition">
          <BarChart3 size={20} className="text-[#59cbe8]" />
          Dashboard
        </Link>
        <Link href="/admin/contracts" className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-[#59cbe8]/10 text-[#f1f5f9] transition">
          <FileText size={20} className="text-[#59cbe8]" />
          Contratos
        </Link>
        <Link href="/admin/customers" className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-[#59cbe8]/10 text-[#f1f5f9] transition">
          <Users size={20} className="text-[#59cbe8]" />
          Clientes
        </Link>
      </nav>

      <button
        onClick={handleLogout}
        className="w-full flex items-center gap-3 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition"
      >
        <LogOut size={20} />
        Sair
      </button>
    </div>
  );
}
