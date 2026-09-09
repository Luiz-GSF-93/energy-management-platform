'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Customer {
  id: string;
  name: string;
  email: string;
  document?: string;
  phone?: string;
  createdAt: string;
}

export default function CustomersPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/auth/login');
      return;
    }

    fetchCustomers();
  }, [token, router]);

  const fetchCustomers = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL;
      const res = await fetch(`${API_URL}/customers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (res.ok) {
        const data = await res.json();
        setCustomers(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '20px' }}>Carregando clientes...</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Clientes</h1>
      <a href="/admin/customers/new" style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', borderRadius: '4px', textDecoration: 'none', marginBottom: '20px', display: 'inline-block' }}>+ Novo Cliente</a>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead style={{ backgroundColor: '#f5f5f5' }}>
          <tr>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Nome</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Email</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Telefone</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {customers.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Nenhum cliente encontrado</td>
            </tr>
          ) : (
            customers.map(customer => (
              <tr key={customer.id}>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{customer.name}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{customer.email}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{customer.phone || '-'}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                  <a href={`/admin/customers/${customer.id}`} style={{ marginRight: '10px', color: '#007bff', textDecoration: 'none' }}>Editar</a>
                  <button onClick={() => alert('Deletar ' + customer.name)} style={{ padding: '5px 10px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Deletar</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
