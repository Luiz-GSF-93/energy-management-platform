'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';

export default function ClientDocuments() {
  const { token } = useAuth();
  const router = useRouter();

  if (!token) router.push('/auth/login');

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Meus Documentos</h1>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead style={{ backgroundColor: '#f5f5f5' }}>
          <tr>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Arquivo</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Tipo</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Data</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Ação</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: '10px', border: '1px solid #ddd' }}>fatura_janeiro_2026.pdf</td>
            <td style={{ padding: '10px', border: '1px solid #ddd' }}>INVOICE</td>
            <td style={{ padding: '10px', border: '1px solid #ddd' }}>15/01/2026</td>
            <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}><a href="#" style={{ color: '#007bff' }}>Baixar</a></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
