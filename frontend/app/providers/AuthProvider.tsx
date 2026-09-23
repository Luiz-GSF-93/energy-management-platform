'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ApiError,
  getAuthContext,
  login as loginRequest,
  switchOrganization as switchOrganizationRequest,
} from '@/app/lib/api';
import type {
  AuthContext,
  LoginRequest,
} from '@/app/lib/api';
import { session } from '@/app/lib/auth/session';

type AuthStatus =
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'error';

interface AuthContextValue {
  status: AuthStatus;
  context: AuthContext | null;
  login(input: LoginRequest): Promise<void>;
  logout(): void;
  refresh(): Promise<void>;
  switchOrganization(
    organizationId: string,
  ): Promise<void>;
  hasPermission(permission: string): boolean;
}

const AuthenticationContext =
  createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({
  children,
}: AuthProviderProps) {
  const [status, setStatus] =
    useState<AuthStatus>('loading');

  const [context, setContext] =
    useState<AuthContext | null>(null);

  const clearAuthentication =
    useCallback(() => {
      session.clear();
      setContext(null);
      setStatus('unauthenticated');
    }, []);

  const refresh = useCallback(async () => {
    const token = session.getAccessToken();

    if (!token) {
      setContext(null);
      setStatus('unauthenticated');
      return;
    }

    setStatus('loading');

    try {
      const nextContext =
        await getAuthContext();

      setContext(nextContext);
      setStatus('authenticated');
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 ||
          error.status === 403)
      ) {
        clearAuthentication();
        return;
      }

      setContext(null);
      setStatus('error');
      throw error;
    }
  }, [clearAuthentication]);

  useEffect(() => {
    void refresh().catch(() => {
      // The route/UI layer may present retry/error
      // behavior in a later slice. Authentication
      // remains fail-closed here.
    });
  }, [refresh]);

  const login = useCallback(
    async (input: LoginRequest) => {
      const result =
        await loginRequest(input);

      if (
        typeof result.access_token !== 'string' ||
        !result.access_token
      ) {
        throw new Error(
          'Resposta de autenticação inválida',
        );
      }

      session.setAccessToken(
        result.access_token,
      );

      try {
        const nextContext =
          await getAuthContext();

        setContext(nextContext);
        setStatus('authenticated');
      } catch (error) {
        session.clear();
        setContext(null);
        setStatus('unauthenticated');
        throw error;
      }
    },
    [],
  );

  const logout = useCallback(() => {
    clearAuthentication();
  }, [clearAuthentication]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      if (
        !context ||
        organizationId ===
          context.currentOrganization.id
      ) {
        return;
      }

      setStatus('loading');

      try {
        await switchOrganizationRequest(
          organizationId,
        );

        const nextContext =
          await getAuthContext();

        setContext(nextContext);
        setStatus('authenticated');
      } catch (error) {
        try {
          const recoveredContext =
            await getAuthContext();

          setContext(recoveredContext);
          setStatus('authenticated');
        } catch {
          clearAuthentication();
        }

        throw error;
      }
    },
    [
      context,
      clearAuthentication,
    ],
  );

  const hasPermission = useCallback(
    (permission: string) =>
      context?.currentOrganization.permissions.includes(
        permission,
      ) ?? false,
    [context],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      context,
      login,
      logout,
      refresh,
      switchOrganization,
      hasPermission,
    }),
    [
      status,
      context,
      login,
      logout,
      refresh,
      switchOrganization,
      hasPermission,
    ],
  );

  return (
    <AuthenticationContext.Provider
      value={value}
    >
      {children}
    </AuthenticationContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(
    AuthenticationContext,
  );

  if (!value) {
    throw new Error(
      'useAuth must be used within AuthProvider',
    );
  }

  return value;
}
