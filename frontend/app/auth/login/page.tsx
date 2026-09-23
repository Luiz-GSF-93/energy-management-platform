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
} from '@/app/components/ui';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('access_token');

    if (token) {
      router.replace('/backoffice/dashboard');
    }
  }, [router]);

  const handleLogin = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    setLoading(true);
    setError('');

    try {
      const apiUrl =
        process.env.NEXT_PUBLIC_API_URL;

      if (!apiUrl) {
        throw new Error(
          'Configuração da API indisponível',
        );
      }

      const response = await fetch(
        `${apiUrl}/api/v1/auth/login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            password,
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Credenciais inválidas');
      }

      const data = await response.json();

      if (
        typeof data?.access_token !== 'string' ||
        !data.access_token
      ) {
        throw new Error(
          'Resposta de autenticação inválida',
        );
      }

      localStorage.setItem(
        'access_token',
        data.access_token,
      );

      if (typeof data?.user?.email === 'string') {
        localStorage.setItem(
          'user_email',
          data.user.email,
        );
      }

      router.replace('/backoffice/dashboard');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Erro ao fazer login',
      );
    } finally {
      setLoading(false);
    }
  };

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
              disabled={loading}
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
              disabled={loading}
            />

            <div className="auth-form__actions">
              <Button
                type="submit"
                disabled={loading}
              >
                {loading
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
