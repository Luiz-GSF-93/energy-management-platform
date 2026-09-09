'use client';

import { useAuth } from '@/app/context/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Document {
  id: string;
  fileName: string;
  fileType: string;
  documentType?: string;
  createdAt: string;
}

export default function DocumentsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      router.push('/auth/login');
      return;
    }

    fetchDocuments();
  }, [token, router]);

  const fetchDocuments = async () => {
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL;
      const res = await fetch(`${API_URL}/documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setDocuments(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Erro ao buscar documentos:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '20px' }}>Carregando documentos...</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Documentos</h1>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px' }}>
        <thead style={{ backgroundColor: '#f5f5f5' }}>
          <tr>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Arquivo</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Tipo</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Data</th>
            <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {documents.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Nenhum documento encontrado</td>
            </tr>
          ) : (
            documents.map(doc => (
              <tr key={doc.id}>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{doc.fileName}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{doc.documentType || '-'}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{new Date(doc.createdAt).toLocaleDateString('pt-BR')}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                  <a href={`#`} style={{ color: '#007bff', textDecoration: 'none' }}>Ver</a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
