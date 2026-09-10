export const dynamic = 'force-dynamic';
'use client';
import { useAuth } from '@/app/context/auth-context';

export default function Documents() {
  const { user, loading } = useAuth();

  if (loading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Documentos</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">Lista de documentos aqui</p>
      </div>
    </div>
  );
}
