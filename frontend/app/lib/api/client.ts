import { session } from '@/app/lib/auth/session';

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
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    authenticated = true,
    body,
    headers,
    ...requestOptions
  } = options;

  const requestHeaders = new Headers(headers);
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;

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
    const token = session.getAccessToken();

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
    throw new ApiError(
      await readErrorMessage(response),
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
