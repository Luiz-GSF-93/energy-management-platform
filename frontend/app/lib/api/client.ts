import { session, endSession } from '@/app/lib/auth/session';
import {freshToken,sessionAttention} from '@/app/lib/auth/renew';
import {portalSelection,portalSelectionKey,portalScopedPath} from '@/app/lib/auth/portal-customer';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getApiBaseUrl(): string {
  const value =
    process.env.NEXT_PUBLIC_API_URL?.trim();

  if (!value) {
    throw new Error(
      'Configuração da API indisponível',
    );
  }

  return value.replace(/\/+$/, '');
}

async function readErrorMessage(
  response: Response,
): Promise<string> {
  try {
    const body = await response.json();

    if (
      typeof body?.message === 'string' &&
      body.message
    ) {
      return body.message;
    }

    if (Array.isArray(body?.message)) {
      return body.message.join(', ');
    }
  } catch {
    // Fall back to the HTTP status below.
  }

  return `Erro HTTP ${response.status}`;
}

interface ApiRequestOptions
  extends Omit<RequestInit, 'body'> {
  body?: unknown;
  authenticated?: boolean;
  responseType?: 'json' | 'blob';
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    authenticated = true,
    responseType = 'json',
    body,
    headers,
    ...requestOptions
  } = options;

  const requestHeaders = new Headers(headers);
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  const scoped=authenticated&&portalScopedPath(path),selected=scoped?portalSelection():null,selectionKey=scoped?portalSelectionKey():null;
  if(selected)requestHeaders.set('x-portal-customer',selected.customerId);

  if (
    body !== undefined &&
    !multipart &&
    !requestHeaders.has('Content-Type')
  ) {
    requestHeaders.set(
      'Content-Type',
      'application/json',
    );
  }

  if (authenticated) {
    const selectedOrganization = session.getOrganizationSession();
    if (selectedOrganization) requestHeaders.set('x-platform-organization-session', selectedOrganization);
    const token = await freshToken();

    if (!token) {
      throw new ApiError(
        'Sessão não autenticada',
        401,
      );
    }

    requestHeaders.set(
      'Authorization',
      `Bearer ${token}`,
    );
  }

  const response = await fetch(
    `${getApiBaseUrl()}${path}`,
    {
      ...requestOptions,
      headers: requestHeaders,
      body:
        body === undefined
          ? undefined
          : multipart ? body as FormData : JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const message=await readErrorMessage(response);
    if(authenticated && response.status===403 && message==='MFA_REQUIRED') window.dispatchEvent(new Event('energyos-mfa-required'));
    if(authenticated && response.status===401) sessionAttention('Seu acesso expirou. Renove o acesso para continuar.','expired');
    if(authenticated && message==='Organization session expired or access revoked') endSession();
    if(scoped&&response.status===403)window.dispatchEvent(new Event('portal-scope-denied'));
    throw new ApiError(
      message,
      response.status,
    );
  }

  if(scoped&&selectionKey!==portalSelectionKey())throw new ApiError('A empresa selecionada mudou. Os dados da consulta anterior foram descartados.',409);

  if (response.status === 204) {
    return undefined as T;
  }

  const result=await (responseType === 'blob' ? response.blob() : response.json());
  if(scoped&&selectionKey!==portalSelectionKey())throw new ApiError('A empresa selecionada mudou. Os dados da consulta anterior foram descartados.',409);
  return result as T;
}
