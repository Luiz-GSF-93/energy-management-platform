"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, ArrowLeft, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('https://energy-management-platform.onrender.com/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error('Email não encontrado');
      }

      setSuccess(true);
      setTimeout(() => router.push('/auth/login'), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl"></div>
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-gradient-to-b from-slate-900/80 to-slate-800/80 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Recuperar Senha</h1>
            <p className="text-slate-400 text-sm">Digite seu email para receber instruções de reset</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-900/20 border border-red-700 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-6 p-4 bg-green-900/20 border border-green-700 rounded-lg flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
              <p className="text-green-400 text-sm">Email enviado! Redirecionando...</p>
            </div>
          )}

          <form onSubmit={handleReset} className="space-y-5">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 disabled:opacity-50 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition"
            >
              {loading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Enviar Link de Reset'
              )}
            </button>
          </form>

          <Link href="/auth/login" className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm mt-6 justify-center transition">
            <ArrowLeft className="w-4 h-4" />
            Voltar ao Login
          </Link>
        </div>
      </div>
    </div>
  );
}
