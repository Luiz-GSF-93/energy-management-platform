'use client';

import { useAuth } from './context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Home() {
  const { user, token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (token && user) {
      // Redirecionar para dashboard apropriado
      router.push('/admin/dashboard');
    }
  }, [token, user, router]);

  if (token) return <div style={{ padding: '20px' }}>Redirecionando...</div>;

  return (
    <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>⚡ Energy Management Platform</h1>
      <p style={{ fontSize: '18px', color: '#666' }}>Gestão completa do Mercado Livre de Energia</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginTop: '40px' }}>
        <div style={{ padding: '30px', backgroundColor: '#f0f8ff', borderRadius: '8px', border: '2px solid #007bff' }}>
          <h3>👨‍💼 Para Administradores</h3>
          <p>Gerencie clientes, contratos e documentos</p>
          <a href="/auth/login" style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '4px', display: 'inline-block' }}>Acessar Backoffice</a>
        </div>

        <div style={{ padding: '30px', backgroundColor: '#f0f8f0', borderRadius: '8px', border: '2px solid #28a745' }}>
          <h3>👤 Para Clientes</h3>
          <p>Acompanhe contratos e economia de energia</p>
          <a href="/auth/login" style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', textDecoration: 'none', borderRadius: '4px', display: 'inline-block' }}>Acessar Portal</a>
        </div>
      </div>

      <div style={{ marginTop: '40px', paddingTop: '40px', borderTop: '1px solid #ddd' }}>
        <h2>Recursos</h2>
        <ul style={{ listStyle: 'none', padding: '0', textAlign: 'left', maxWidth: '400px', margin: '20px auto' }}>
          <li>✅ Gerenciamento de Clientes</li>
          <li>✅ Contratos de Energia</li>
          <li>✅ Cálculo de Economia</li>
          <li>✅ Documentos e Faturas</li>
          <li>✅ Dashboard e Relatórios</li>
          <li>✅ Autenticação Segura</li>
        </ul>
      </div>
    </div>
  );
}
