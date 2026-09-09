'use client';

import { useAuth } from '@/app/context/auth-context';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function Customers() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Clientes</h1>
        <Link href="/admin/customers/new" className="bg-blue-600 text-white px-4 py-2 rounded">
          Novo Cliente
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-4 py-2">Nome</th>
              <th className="border px-4 py-2">Email</th>
              <th className="border px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={3} className="text-center py-4">Nenhum cliente</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
