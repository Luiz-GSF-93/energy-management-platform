'use client';

import { useAuth } from '@/app/context/auth-context';
import { useState } from 'react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function NewCustomer() {
  const { user, isLoading } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    document: '',
    phone: '',
    address: '',
    city: '',
    state: '',
  });

  if (isLoading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implementar chamada ao backend
    console.log('Form submitted:', formData);
  };

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Novo Cliente</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-bold mb-2">Nome</label>
          <input type="text" className="w-full border px-4 py-2 rounded" required />
        </div>
        <div>
          <label className="block font-bold mb-2">Email</label>
          <input type="email" className="w-full border px-4 py-2 rounded" required />
        </div>
        <div>
          <label className="block font-bold mb-2">Documento</label>
          <input type="text" className="w-full border px-4 py-2 rounded" />
        </div>
        <div className="flex gap-4">
          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded">
            Salvar
          </button>
          <Link href="/admin/customers" className="bg-gray-400 text-white px-6 py-2 rounded">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
