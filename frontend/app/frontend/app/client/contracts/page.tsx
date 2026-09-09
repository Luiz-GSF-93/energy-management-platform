'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';

export default function ClientContracts() {
  const { token } = useAuth();
  const router = useRouter();

  if (!token) router.push('/auth/login');

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Meus Contratos</h1>

      <div style={{ display: 'grid', gap: '20px', marginTop: '20px' }}>
        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>Contrato #CONT-2026-001</h3>
          <p>Status: <span style={{ padding: '2px 8px', backgroundColor: '#28a745', color: 'white', borderRadius: '4px', fontSize: '12px' }}>ATIVO</span></p>
          <p>Período: 01/01/2026 - 31/12/2026</p>
          <p>Economia prevista: R$ 25.000,00</p>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
          <h3>Contrato #CONT-2026-002</h3>
          <p>Status: <span style={{ padding: '2px 8px', backgroundColor: '#28a745', color: 'white', borderRadius: '4px', fontSize: '12px' }}>ATIVO</span></p>
          <p>Período: 15/02/2026 - 14/02/2027</p>
          <p>Economia prevista: R$ 18.000,00</p>
        </div>
      </div>
    </div>
  );
}
