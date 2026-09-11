'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLogin: string;
  createdAt: string;
}

export default function UsersManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(
        'https://energy-management-platform.onrender.com/api/v1/users',
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Erro ao carregar usuários');
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      ADMIN: 'bg-red-900/30 text-red-300',
      BACKOFFICE_MANAGER: 'bg-blue-900/30 text-blue-300',
      BACKOFFICE_ANALYST: 'bg-purple-900/30 text-purple-300',
      CLIENT: 'bg-green-900/30 text-green-300',
      SUPPORT: 'bg-yellow-900/30 text-yellow-300',
    };
    return colors[role] || 'bg-slate-900/30 text-slate-300';
  };

  const filteredUsers = filter === 'ALL' 
    ? users 
    : users.filter((u) => u.role === filter);

  if (loading) return <div className="text-center py-12 text-slate-400">Carregando...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Gestão de Usuários</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-700/50 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-300">{error}</p>
        </div>
      )}

      {/* Filtros */}
      <div className="mb-6 flex gap-2 flex-wrap">
        {['ALL', 'ADMIN', 'BACKOFFICE_MANAGER', 'BACKOFFICE_ANALYST', 'CLIENT'].map((role) => (
          <button
            key={role}
            onClick={() => setFilter(role)}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              filter === role
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {role.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Tabela */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg overflow-hidden backdrop-blur">
        <table className="w-full">
          <thead className="bg-slate-900/50 border-b border-slate-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Nome</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Email</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Função</th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-slate-300">Status</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Último Acesso</th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-slate-300">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-slate-800/50 transition">
                <td className="px-6 py-4 text-sm text-slate-200 font-medium">{user.name}</td>
                <td className="px-6 py-4 text-sm text-slate-400">{user.email}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getRoleColor(user.role)}`}>
                    {user.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-center">
                  {user.isActive ? (
                    <CheckCircle className="w-5 h-5 text-green-400 mx-auto" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-400 mx-auto" />
                  )}
                </td>
                <td className="px-6 py-4 text-xs text-slate-500">
                  {user.lastLogin
                    ? new Date(user.lastLogin).toLocaleString('pt-BR')
                    : 'Nunca'}
                </td>
                <td className="px-6 py-4 text-center">
                  <div className="flex justify-center gap-2">
                    <button className="p-2 hover:bg-slate-700 rounded transition">
                      <Edit2 className="w-4 h-4 text-blue-400" />
                    </button>
                    <button className="p-2 hover:bg-slate-700 rounded transition">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
