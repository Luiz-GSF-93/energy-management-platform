export const dynamic = 'force-dynamic';
'use client';
import { useAuth } from '@/app/context/auth-context';

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-blue-100 p-6 rounded-lg">
          <h3 className="text-lg font-semibold">Total de Contratos</h3>
          <p className="text-3xl font-bold text-blue-600">0</p>
        </div>
        <div className="bg-green-100 p-6 rounded-lg">
          <h3 className="text-lg font-semibold">Economia Total</h3>
          <p className="text-3xl font-bold text-green-600">R$ 0,00</p>
        </div>
        <div className="bg-yellow-100 p-6 rounded-lg">
          <h3 className="text-lg font-semibold">Pendentes</h3>
          <p className="text-3xl font-bold text-yellow-600">0</p>
        </div>
        <div className="bg-purple-100 p-6 rounded-lg">
          <h3 className="text-lg font-semibold">Usuários Ativos</h3>
          <p className="text-3xl font-bold text-purple-600">1</p>
        </div>
      </div>
    </div>
  );
}
