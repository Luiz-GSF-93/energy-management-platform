'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      console.log('🔗 API URL:', apiUrl);

      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Credenciais inválidas');
      }

      const data = await response.json();
      console.log('✅ Login bem-sucedido:', data);

      // Salve o token
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('user_email', data.user.email);

      // Determine para onde redirecionar
      if (email.includes('admin') || email.includes('gerente') || email.includes('analista') || email.includes('suporte')) {
        console.log('🔄 Redirecionando para backoffice...');
        router.push('/backoffice/dashboard');
      } else {
        console.log('🔄 Redirecionando para dashboard cliente...');
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
      console.error('❌ Erro de login:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-blue-400 mb-2">Expert Energy</h1>
          <p className="text-gray-400">Gestão Inteligente do Mercado Livre</p>
        </div>

        <form onSubmit={handleLogin} className="bg-gray-800 rounded-lg shadow-xl p-8 space-y-6">
          <h2 className="text-2xl font-bold text-white mb-6">Fazer Login</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded">
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
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition"
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
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition duration-200"
          >
            {loading ? '⏳ Entrando...' : '✓ Entrar'}
          </button>

          <div className="text-center text-sm text-gray-400">
            <Link href="/auth/forgot-password" className="hover:text-blue-400">
              Esqueceu a senha?
            </Link>
          </div>
        </form>

        <div className="mt-8 bg-gray-800/50 rounded-lg p-4 text-sm text-gray-400">
          <p className="font-bold text-gray-300 mb-2">📋 Credenciais de Teste:</p>
          <p>👤 Admin: admin@expertenergy.com.br / Admin@2026!</p>
          <p>👤 Cliente: teste@expertenergy.com.br / ExpertEnergy@2026!</p>
        </div>
      </div>
    </div>
  );
}
