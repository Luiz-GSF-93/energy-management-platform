'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Card, Input } from '@/app/components/ui';
import { apiRequest } from '@/app/lib/api/client';
import { useAuth } from '@/app/providers';

export default function ResetPasswordPage() {
  const token = useRef<string | null>(null);
  const captured = useRef(false);
  const { logout } = useAuth();
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!captured.current) {
      captured.current = true;
      const params = new URLSearchParams(window.location.hash.slice(1));
      const hash = params.get('token_hash');
      if (params.get('type') === 'recovery' && hash && /^[a-fA-F0-9]{32,128}$/.test(hash)) token.current = hash;
      window.history.replaceState(null, '', window.location.pathname);
    }
    const timer = window.setTimeout(() => { setHasToken(Boolean(token.current)); setReady(true); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token.current) return;
    if (password !== confirmation) { setError('As senhas devem ser iguais.'); return; }
    setBusy(true); setError('');
    try {
      await apiRequest('/api/v1/auth/reset-password', {
        method: 'POST', authenticated: false, body: { token_hash: token.current, password },
      });
      token.current = null; setPassword(''); setConfirmation(''); logout(); setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir. Solicite um novo link.');
    } finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-shell"><Card>
    <h1>Redefinir senha</h1>
    {!ready ? <p>Preparando recuperação...</p> : done ? <p role="status">Senha alterada. Entre novamente com sua nova senha.</p> : !hasToken ?
      <Alert variant="error">Link inválido ou incompleto. Solicite um novo link de recuperação.</Alert> :
      <form className="auth-form" onSubmit={submit}>
        <p>Crie uma senha de 10 a 128 caracteres. O link é de uso único.</p>
        {error && <Alert variant="error">{error}</Alert>}
        <Input label="Nova senha" type="password" autoComplete="new-password" required minLength={10} maxLength={128}
          value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        <Input label="Confirmar nova senha" type="password" autoComplete="new-password" required minLength={10} maxLength={128}
          value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} />
        <Button type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar nova senha'}</Button>
      </form>}
    <p><Link href="/auth/login">Voltar ao login</Link></p>
    {!done && <p><Link href="/auth/forgot-password">Solicitar novo link</Link></p>}
  </Card></div></main>;
}
