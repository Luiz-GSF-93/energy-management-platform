'use client';

import {
  FormEvent,
  useEffect,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import {
  Alert,
  Button,
  Card,
  Input,
  LoadingState,
} from '@/app/components/ui';
import { useAuth } from '@/app/providers';

export default function LoginPage() {
  const router = useRouter();

  const {
    status,
    login,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] =
    useState('');
  const [submitting, setSubmitting] =
    useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/backoffice/dashboard');
    }
  }, [router, status]);

  const handleLogin = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    setSubmitting(true);
    setError('');

    try {
      await login({
        email,
        password,
      });

      router.replace(
        '/backoffice/dashboard',
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao fazer login',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading') {
    return (
      <main className="auth-page">
        <div className="auth-shell">
          <LoadingState
            title="Validando sessão..."
            description="Verificando o contexto de acesso."
          />
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <header className="auth-brand">
          <h1 className="auth-brand__name">
            Expert Energy
          </h1>

          <p className="auth-brand__description">
            Gestão Inteligente do Mercado Livre
          </p>
        </header>

        <Card>
          <form
            className="auth-form"
            onSubmit={handleLogin}
          >
            <h2 className="auth-form__title">
              Fazer login
            </h2>

            {error ? (
              <Alert variant="error">
                {error}
              </Alert>
            ) : null}

            <Input
              label="E-mail"
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="seu@email.com"
              autoComplete="email"
              required
              disabled={submitting}
            />

            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="••••••••"
              autoComplete="current-password"
              required
              disabled={submitting}
            />

            <div className="auth-form__actions">
              <Button
                type="submit"
                disabled={submitting}
              >
                {submitting
                  ? 'Entrando...'
                  : 'Entrar'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
