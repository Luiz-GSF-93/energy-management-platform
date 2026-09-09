'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface DashboardStats {
  totalCustomers: number;
  totalUnits: number;
  totalContracts: number;
  totalDocuments: number;
  totalSavings: number;
}

export default function AdminDashboard() {
  const { user, token } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    totalCustomers: 0,
    totalUnits: 0,
    totalContracts: 0,
    totalDocuments: 0,
    totalSavings: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/auth/login');
      return;
    }

    fetchStats();
  }, [token, router]);

  const fetchStats = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL;
      
      const [customers, units, contracts, documents] = await Promise.all([
        fetch(`${API_URL}/customers`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
        fetch(`${API_URL}/consumer-units`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
        fetch(`${API_URL}/contracts`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
        fetch(`${API_URL}/documents`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
      ]);

      setStats({
        totalCustomers: Array.isArray(customers) ? customers.length : 0,
        totalUnits: Array.isArray(units) ? units.length : 0,
        totalContracts: Array.isArray(contracts) ? contracts.length : 0,
        totalDocuments: Array.isArray(documents) ? documents.length : 0,
        totalSavings: Math.random() * 100000, // placeholder
      });
    } catch (error) {
      console.error('Erro ao buscar stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '20px' }}>Carregando...</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>⚡ Dashboard Administrativo</h1>
      <p>Bem-vindo, {user?.email}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginTop: '30px' }}>
        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>{stats.totalCustomers}</h3>
          <p>Clientes</p>
          <a href="/admin/customers">Ver detalhes →</a>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>{stats.totalUnits}</h3>
          <p>Unidades Consumidoras</p>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>{stats.totalContracts}</h3>
          <p>Contratos Ativos</p>
          <a href="/admin/contracts">Ver detalhes →</a>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>{stats.totalDocuments}</h3>
          <p>Documentos</p>
          <a href="/admin/documents">Ver detalhes →</a>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f0f8f0' }}>
          <h3>R$ {stats.totalSavings.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</h3>
          <p>Economia Total</p>
        </div>
      </div>

      <div style={{ marginTop: '30px' }}>
        <h2>Ações Rápidas</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <a href="/admin/customers/new" style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', borderRadius: '4px', textDecoration: 'none' }}>+ Novo Cliente</a>
          <a href="/admin/contracts/new" style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', borderRadius: '4px', textDecoration: 'none' }}>+ Novo Contrato</a>
          <a href="/admin/documents" style={{ padding: '10px 20px', backgroundColor: '#17a2b8', color: 'white', borderRadius: '4px', textDecoration: 'none' }}>📄 Documentos</a>
        </div>
      </div>
    </div>
  );
}
