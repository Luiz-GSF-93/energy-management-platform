'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ClientLayout({
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
      <nav style={{ width: '250px', backgroundColor: '#1e5f8f', color: 'white', padding: '20px' }}>
        <h2>⚡ Minha Energia</h2>
        
        <ul style={{ listStyle: 'none', padding: '0', margin: '20px 0' }}>
          <li style={{ marginBottom: '10px' }}>
            <a href="/client/dashboard" style={{ color: 'white', textDecoration: 'none', display: 'block', padding: '10px', borderRadius: '4px' }}>📊 Dashboard</a>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <a href="/client/contracts" style={{ color: 'white', textDecoration: 'none', display: 'block', padding: '10px', borderRadius: '4px' }}>📄 Contratos</a>
          </li>
          <li style={{ marginBottom: '10px' }}>
            <a href="/client/documents" style={{ color: 'white', textDecoration: 'none', display: 'block', padding: '10px', borderRadius: '4px' }}>📁 Documentos</a>
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
