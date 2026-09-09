'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function ClientDashboard() {
  const { user, token } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/auth/login');
      return;
    }
    setLoading(false);
  }, [token, router]);

  if (loading) return <div style={{ padding: '20px' }}>Carregando...</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Meu Portal de Energia</h1>
      <p>Bem-vindo, {user?.email}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginTop: '30px' }}>
        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>💰 Economia Total</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>R$ 45.230,50</p>
          <small>Últimos 12 meses</small>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>📊 Consumo Mensal</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>1.250 kWh</p>
          <small>Mês anterior</small>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>📋 Contratos Ativos</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>2</p>
          <a href="/client/contracts" style={{ color: '#007bff', textDecoration: 'none' }}>Ver detalhes →</a>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>📁 Documentos</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>8</p>
          <a href="/client/documents" style={{ color: '#007bff', textDecoration: 'none' }}>Ver documentos →</a>
        </div>
      </div>

      <div style={{ marginTop: '40px' }}>
        <h2>Últimas Atividades</h2>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', border: '1px solid #ddd' }}>
          <p style={{ color: '#999', marginTop: '0' }}>Nenhuma atividade recente</p>
        </div>
      </div>
    </div>
  );
}
