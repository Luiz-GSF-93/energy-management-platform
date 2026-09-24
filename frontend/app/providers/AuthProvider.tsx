'use client';
import { apiRequest } from '@/app/lib/api/client';

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
  getPlatformContext,
  login as loginRequest,
  switchOrganization as switchOrganizationRequest,
} from '@/app/lib/api';
import type {
  AuthContext,
  LoginRequest,
  OrganizationAuthContext,
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
  enterOrganization(id: string): Promise<void>;
  leaveOrganization(): Promise<void>;
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

function isOrganizationContext(
  context: AuthContext | null,
): context is OrganizationAuthContext {
  return (
    context !== null &&
    context.scope !== 'global'
  );
}

async function resolveAccessContext():
  Promise<AuthContext> {
  try {
    return await getAuthContext();
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      error.status !== 403
    ) {
      throw error;
    }
  }

  session.setOrganizationSession(null);
  return getPlatformContext();
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
        await resolveAccessContext();

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
    const bootstrap = async () => {
      await refresh();
    };

    const timeoutId = window.setTimeout(() => {
      void bootstrap().catch(() => {
        // ProtectedRoute exposes the retry path.
        // Authentication remains fail-closed.
      });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
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
          await resolveAccessContext();

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
        !isOrganizationContext(context) ||
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

  const enterOrganization = useCallback(async (id: string) => {
    const result = await apiRequest<{ session_id: string }>(
      '/api/v1/admin/organizations/' + encodeURIComponent(id) + '/operate', { method: 'POST' });
    session.setOrganizationSession(result.session_id);
    await refresh();
  }, [refresh]);

  const leaveOrganization = useCallback(async () => {
    session.setOrganizationSession(null);
    setStatus('loading');
    try { setContext(await getPlatformContext()); setStatus('authenticated'); }
    catch { await refresh(); }
  }, [refresh]);

  const hasPermission = useCallback(
    (permission: string) => {
      if (!context) {
        return false;
      }

      if (context.scope === 'global') {
        return context.permissions.includes(
          permission,
        );
      }

      return (
        context.currentOrganization.permissions
          .includes(permission)
      );
    },
    [context],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      context,
      login,
      logout,
      enterOrganization,
      leaveOrganization,
      refresh,
      switchOrganization,
      hasPermission,
    }),
    [
      status,
      context,
      login,
      logout,
      enterOrganization,
      leaveOrganization,
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
