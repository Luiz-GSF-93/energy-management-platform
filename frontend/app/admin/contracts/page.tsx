'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Contract {
  id: string;
  contractNumber: string;
  status: string;
  startDate: string;
  endDate: string;
  minimumSavings?: number;
}

export default function ContractsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/auth/login');
      return;
    }

    fetchContracts();
  }, [token, router]);

  const fetchContracts = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL;
      const res = await fetch(`${API_URL}/contracts`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setContracts(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Erro ao buscar contratos:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '20px' }}>Carregando contratos...</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Contratos de Energia</h1>
      <a href="/admin/contracts/new" style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', borderRadius: '4px', textDecoration: 'none', marginBottom: '20px', display: 'inline-block' }}>+ Novo Contrato</a>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead style={{ backgroundColor: '#f5f5f5' }}>
          <tr>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Contrato</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Status</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Início</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Término</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {contracts.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Nenhum contrato encontrado</td>
            </tr>
          ) : (
            contracts.map(contract => (
              <tr key={contract.id}>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{contract.contractNumber}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}><span style={{ padding: '4px 8px', backgroundColor: contract.status === 'ACTIVE' ? '#28a745' : '#dc3545', color: 'white', borderRadius: '4px', fontSize: '12px' }}>{contract.status}</span></td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{new Date(contract.startDate).toLocaleDateString('pt-BR')}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{new Date(contract.endDate).toLocaleDateString('pt-BR')}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                  <a href={`/admin/contracts/${contract.id}`} style={{ marginRight: '10px', color: '#007bff', textDecoration: 'none' }}>Editar</a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
