const ACCESS_TOKEN_KEY = 'access_token';

export const session = {
  getOrganizationSession(): string | null {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem('organization_operation');
  },
  setOrganizationSession(id: string | null): void {
    if (typeof window === 'undefined') return;
    if (id) window.sessionStorage.setItem('organization_operation', id);
    else window.sessionStorage.removeItem('organization_operation');
  },
  getAccessToken(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage.getItem(
      ACCESS_TOKEN_KEY,
    );
  },

  setAccessToken(token: string): void {
    window.localStorage.setItem(
      ACCESS_TOKEN_KEY,
      token,
    );
  },

  clear(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.removeItem('organization_operation');
    window.localStorage.removeItem(
      ACCESS_TOKEN_KEY,
    );

    // Remove the legacy presentation-only value
    // previously written by the login page.
    window.localStorage.removeItem(
      'user_email',
    );
  },
};
