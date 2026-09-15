'use client';

import ProtectedRoute from '@/app/components/ProtectedRoute';
import Sidebar from '@/app/components/Sidebar';

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <div className="flex h-screen bg-[#0f172a]">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <h1 className="text-3xl font-bold text-[#59cbe8]">Dashboard</h1>
          <p className="text-[#cbd5e1] mt-2">Bem-vindo ao Expert Energy</p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-8">
            {[
              { label: 'Total de Contratos', value: '0' },
              { label: 'Economia Gerada', value: 'R$ 0,00' },
              { label: 'Pendentes', value: '0' },
              { label: 'Taxa de Aprovação', value: '100%' },
            ].map((card, i) => (
              <div key={i} className="bg-gradient-to-br from-[#59cbe8] to-[#00d4ff] p-6 rounded-lg text-white">
                <p className="text-sm opacity-90">{card.label}</p>
                <h3 className="text-2xl font-bold mt-2">{card.value}</h3>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
