"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, LogIn, AlertCircle, Loader } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@expertenergy.com.br');
  const [password, setPassword] = useState('Admin@2026!');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const testCredentials = [
    { role: 'Admin', email: 'admin@expertenergy.com.br', password: 'Admin@2026!' },
    { role: 'Cliente', email: 'teste@expertenergy.com.br', password: 'ExpertEnergy@2026!' },
    { role: 'Gerente', email: 'gerente@expertenergy.com.br', password: 'Gerente@2026!' },
  ];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('https://energy-management-platform.onrender.com/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Credenciais inválidas');
      }

      const data = await response.json();
      localStorage.setItem('auth_token', data.access_token);

      if (data.user.role === 'CLIENT') {
        router.push('/dashboard');
      } else {
        router.push('/backoffice/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  const fillCredentials = (cred: typeof testCredentials[0]) => {
    setEmail(cred.email);
    setPassword(cred.password);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center p-4">
      {/* Background Effect */}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl"></div>
      </div>

      <div className="relative w-full max-w-md">
        {/* Main Card */}
        <div className="bg-gradient-to-b from-slate-900/80 to-slate-800/80 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full mb-4">
              <span className="text-2xl font-bold text-white">⚡</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent mb-2">
              Expert Energy
            </h1>
            <p className="text-slate-400 text-sm">Bem-vindo de volta</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-900/20 border border-red-700 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
                  placeholder="seu@email.com"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-slate-300">Senha</label>
                <Link href="/auth/forgot-password" className="text-xs text-blue-400 hover:text-blue-300 transition">
                  Esqueceu a senha?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition transform hover:scale-105 active:scale-95"
            >
              {loading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Entrar
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-700"></div>
            <span className="text-xs text-slate-500">Credenciais de Teste</span>
            <div className="flex-1 h-px bg-slate-700"></div>
          </div>

          {/* Test Credentials */}
          <div className="space-y-2 mb-6">
            {testCredentials.map((cred, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => fillCredentials(cred)}
                className="w-full p-3 bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600 rounded-lg text-left transition text-sm"
              >
                <div className="font-medium text-slate-300">{cred.role}</div>
                <div className="text-xs text-slate-500">{cred.email}</div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-slate-500">
            © 2026 Expert Energy. Todos os direitos reservados.
          </p>
        </div>

        {/* Support Link */}
        <p className="text-center mt-6 text-sm text-slate-400">
          Problemas ao acessar?{' '}
          <a href="mailto:suporte@expertenergy.com.br" className="text-blue-400 hover:text-blue-300 transition">
            Entre em contato
          </a>
        </p>
      </div>
    </div>
  );
}
