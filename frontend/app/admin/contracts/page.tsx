'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/auth-context';

export default function Contracts() {
  const { user, loading } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!loading && user) {
      // Fetch contracts from API
      setIsLoading(false);
    }
  }, [loading, user]);

  if (loading || isLoading) return <div className="p-8">Carregando...</div>;
  if (!user) return <div className="p-8">Acesso negado</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Contratos de Energia</h1>
      
      <div className="bg-white rounded-lg shadow p-6">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">ID</th>
              <th className="text-left py-2">Consumidor</th>
              <th className="text-left py-2">Status</th>
              <th className="text-left py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-4 text-gray-500">
                  Nenhum contrato encontrado
                </td>
              </tr>
            ) : (
              contracts.map((contract: any) => (
                <tr key={contract.id} className="border-b hover:bg-gray-50">
                  <td className="py-2">{contract.id}</td>
                  <td className="py-2">{contract.consumer}</td>
                  <td className="py-2">
                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                      {contract.status}
                    </span>
                  </td>
                  <td className="py-2">
                    <button className="text-blue-600 hover:text-blue-800 mr-4">Editar</button>
                    <button className="text-red-600 hover:text-red-800">Deletar</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
