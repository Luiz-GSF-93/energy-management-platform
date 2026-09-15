'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token) {
        router.push('/backoffice/dashboard');
      }
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Credenciais inválidas');
      }

      const data = await response.json();
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user_email', data.user.email);

      router.push('/backoffice/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-[#59cbe8] mb-2">Expert Energy</h1>
          <p className="text-gray-400">Gestão Inteligente do Mercado Livre</p>
        </div>

        <form onSubmit={handleLogin} className="bg-gray-800 rounded-lg shadow-xl p-8 space-y-6">
          <h2 className="text-2xl font-bold text-white mb-6">Fazer Login</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              required
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-[#59cbe8] focus:ring-2 focus:ring-[#59cbe8]"
            />
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-[#59cbe8] focus:ring-2 focus:ring-[#59cbe8]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#59cbe8] hover:bg-[#00d4ff] disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition"
          >
            {loading ? '⏳ Entrando...' : '✓ Entrar'}
          </button>
        </form>

        <div className="mt-8 bg-gray-800/50 rounded-lg p-4 text-sm text-gray-400">
          <p className="font-bold text-gray-300 mb-2">📋 Teste:</p>
          <p>admin@expertenergy.com.br / Admin@2026!</p>
        </div>
      </div>
    </div>
  );
}
