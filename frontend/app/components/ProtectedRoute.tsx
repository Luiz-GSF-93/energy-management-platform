'use client';

import {
  ReactNode,
  useEffect,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';

import { LoadingState } from '@/app/components/ui';

interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({
  children,
}: ProtectedRouteProps) {
  const router = useRouter();
  const [authorized, setAuthorized] =
    useState(false);

  useEffect(() => {
    const token =
      localStorage.getItem('access_token');

    if (!token) {
      router.replace('/auth/login');
      return;
    }

    setAuthorized(true);
  }, [router]);

  if (!authorized) {
    return (
      <LoadingState
        title="Validando acesso..."
        description="Preparando o ambiente administrativo."
      />
    );
  }

  return <>{children}</>;
}
