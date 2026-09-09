'use client';

import { useAuth } from '@/app/context/auth-context';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function AdminDashboard() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-100 p-6 rounded">
          <h2 className="font-bold">Clientes</h2>
          <p className="text-2xl">0</p>
        </div>
        <div className="bg-green-100 p-6 rounded">
          <h2 className="font-bold">Unidades</h2>
          <p className="text-2xl">0</p>
        </div>
        <div className="bg-yellow-100 p-6 rounded">
          <h2 className="font-bold">Contratos</h2>
          <p className="text-2xl">0</p>
        </div>
        <div className="bg-purple-100 p-6 rounded">
          <h2 className="font-bold">Documentos</h2>
          <p className="text-2xl">0</p>
        </div>
      </div>
    </div>
  );
}
