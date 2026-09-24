'use client';
import { useState } from 'react';
import { Alert, Button } from '@/app/components/ui';
import { apiRequest } from '@/app/lib/api/client';

export default function RecoveryAction({ userId, email, disabled }: { userId: string; email: string; disabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function send() {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await apiRequest<{ message: string }>('/api/v1/admin/users/' + encodeURIComponent(userId) + '/recovery-email', { method: 'POST', body: {} });
      setMessage(response.message); setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível solicitar o envio.');
    } finally { setBusy(false); }
  }
  return <div>
    {message && <p role="status">{message}</p>}
    {error && <Alert variant="error">{error}</Alert>}
    {confirming ? <fieldset disabled={busy || disabled} className="organizations-create__form">
      <legend>Confirmar envio de recuperação</legend>
      <p>Enviar um link para <strong>{email}</strong>?</p>
      <p>O usuário escolherá sua nova senha. Ela será usada para entrar em todas as organizações vinculadas à conta.</p>
      <Button type="button" onClick={send} disabled={busy || disabled}>{busy ? 'Solicitando...' : 'Confirmar envio'}</Button>
      <Button type="button" variant="secondary" onClick={() => { setConfirming(false); setError(''); }} disabled={busy}>Cancelar</Button>
    </fieldset> : <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => { setConfirming(true); setMessage(''); setError(''); }}>Enviar recuperação de senha</Button>}
  </div>;
}
