'use client';
import { useAuth } from '@/app/context/auth-context';

export default function Customers() {
  const { user, loading } = useAuth();

  if (loading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Clientes</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">Lista de clientes aqui</p>
      </div>
    </div>
  );
}
