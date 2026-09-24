'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Card, Input } from '@/app/components/ui';
import { apiRequest } from '@/app/lib/api/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await apiRequest<{ message: string }>('/api/v1/auth/forgot-password', {
        method: 'POST', authenticated: false, body: { email: email.trim() },
      });
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível solicitar o link. Tente novamente.');
    } finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-shell"><Card>
    <form className="auth-form" onSubmit={submit}>
      <h1>Recuperar senha</h1>
      <p>Informe o e-mail usado para acessar a Expert Energy.</p>
      {error && <Alert variant="error">{error}</Alert>}
      {message ? <p role="status">{message}</p> : <>
        <Input label="E-mail" type="email" autoComplete="email" required maxLength={254}
          value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
        <Button type="submit" disabled={busy}>{busy ? 'Solicitando...' : 'Enviar link de recuperação'}</Button>
      </>}
      <Link href="/auth/login">Voltar ao login</Link>
    </form>
  </Card></div></main>;
}
