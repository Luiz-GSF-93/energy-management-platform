'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, token, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) {
      router.push('/auth/login');
    }
  }, [token, router]);

  if (!token) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <nav style={{ width: '250px', backgroundColor: '#2c3e50', color: 'white', padding: '20px', boxShadow: '2px 0 5px rgba(0,0,0,0.1)' }}>
        <h2>⚡ Energy Platform</h2>
        
        <div style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <p style={{ fontSize: '12px', color: '#bbb', margin: '0 0 5px 0' }}>Usuário</p>
          <p style={{ margin: '0', fontWeight: 'bold' }}>{user?.email}</p>
        </div>

        <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
          <li style={{ marginBottom: '10px' }}>
            <a href="/admin/dashboard" style={{ color: 'white', textDecoration: 'none', display: 'block', padding: '10px', borderRadius: '4px', hover: { backgroundColor: '#34495e' } }}>📊 Dashboard</a>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <a href="/admin/customers" style={{ color: 'white', textDecoration: 'none', display: 'block', padding: '10px', borderRadius: '4px' }}>👥 Clientes</a>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <a href="/admin/contracts" style={{ color: 'white', textDecoration: 'none', display: 'block', padding: '10px', borderRadius: '4px' }}>📄 Contratos</a>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <a href="/admin/documents" style={{ color: 'white', textDecoration: 'none', display: 'block', padding: '10px', borderRadius: '4px' }}>📁 Documentos</a>
          </li>
        </ul>

        <button onClick={logout} style={{ width: '100%', marginTop: '30px', padding: '10px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
      </nav>

      {/* Main Content */}
      <main style={{ flex: 1, backgroundColor: '#f5f5f5', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
