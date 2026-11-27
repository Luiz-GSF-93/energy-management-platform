'use client';

import {
  FormEvent,
  useEffect,
  useState,
} from 'react';
import Link from 'next/link';
import EnergyOSLogo from '@/app/components/EnergyOSLogo';
import AuthenticatedDestination from '@/app/components/AuthenticatedDestination';
import LoginInstitutionalPanel from '@/app/components/LoginInstitutionalPanel';
import {useLoginLanguage,loginText} from '@/app/components/login-language';
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
  const {language,setLanguage}=useLoginLanguage();
  const t=(text:string)=>loginText(language,text);

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
    if (status === 'mfa_required') router.replace('/auth/mfa');
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

  if (status === 'authenticated') return <AuthenticatedDestination/>;

  if (status === 'loading' || status === 'mfa_required') {
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
    <main className="auth-page auth-page--login">
      <div className="auth-login-layout">
      <div className="auth-login-form-pane">
      <div className="auth-shell auth-shell--login">
        <header className="auth-brand">
          <label className="auth-login-language">{t('Idioma')}<select aria-label={t('Idioma')} value={language} onChange={e=>setLanguage(e.target.value)}><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option></select></label>
          <h1 className="auth-brand__name"><EnergyOSLogo className="auth-brand__logo" /></h1>

          <p className="auth-brand__description auth-brand__powered">
            Powered by Expert Energy
          </p>
        </header>

        <Card>
          <form
            className="auth-form"
            onSubmit={handleLogin}
          >
            <h2 className="auth-form__title">
              {t('Fazer login')}
            </h2>

            {error ? (
              <Alert variant="error">
                {error}
              </Alert>
            ) : null}

            <Input
              label={t('E-mail')}
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder={t('seu@email.com')}
              autoComplete="email"
              required
              disabled={submitting}
            />

            <Input
              label={t('Senha')}
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
                  ? t('Entrando...')
                  : t('Entrar')}
              </Button>
            </div>
            <Link href="/auth/forgot-password">{t('Esqueci minha senha')}</Link>
            <div className="auth-account-preview"><span role="link" aria-disabled="true">{t('Não tenho conta')}</span><small>{t('Em breve')}</small></div>
          </form>
        </Card>
      </div>
      <footer className="auth-login-site-footer"><span>by expert energy</span><span>© 2026 EnergyOS - E.E.P.E - {t('Todos os direitos reservados.')} v1.1.2</span><a href={'https://www.energy-os.app.br/politica-de-privacidade/'+(language==='pt'?'':language+'/')}>{t('Política de Privacidade')}</a></footer>
      </div>
      <LoginInstitutionalPanel language={language} />
      </div>
    </main>
  );
}
