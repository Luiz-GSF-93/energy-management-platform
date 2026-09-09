'use client';

import { useAuth } from '@/app/context/auth-context';

export const dynamic = 'force-dynamic';

export default function Contracts() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Contratos</h1>
      <table className="min-w-full border">
        <thead className="bg-gray-100">
          <tr>
            <th className="border px-4 py-2">Número</th>
            <th className="border px-4 py-2">Status</th>
            <th className="border px-4 py-2">Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={3} className="text-center py-4">Nenhum contrato</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
