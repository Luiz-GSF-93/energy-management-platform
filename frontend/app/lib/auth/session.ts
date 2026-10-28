const ACCESS_TOKEN_KEY = 'access_token';
let expectedUser: string | null = null;

export function tokenClaims(token: string | null): {sub?:string;exp?:number} {
  try {return JSON.parse(atob((token||'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));} catch {return {};}
}

export const session = {
  expectUser(id: string | null) { expectedUser = id; },
  getExpectedUser() { return expectedUser; },
  setTokens(value: {access_token:string;refresh_token?:string}): void {
    for(const key of ['access_token','refresh_token','user_email'])window.localStorage.removeItem(key);
    window.sessionStorage.setItem('access_token',value.access_token);
    if(value.refresh_token) window.sessionStorage.setItem('refresh_token',value.refresh_token);
    else window.sessionStorage.removeItem('refresh_token');
    window.dispatchEvent(new Event('session-renewed'));
  },
  getRefreshToken(): string | null {
    return typeof window==='undefined'?null:window.sessionStorage.getItem('refresh_token');
  },
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

    for(const key of ['access_token','refresh_token','user_email'])window.localStorage.removeItem(key);
    return window.sessionStorage.getItem(
      ACCESS_TOKEN_KEY,
    );
  },

  setAccessToken(token: string): void {
    for(const key of ['access_token','refresh_token','user_email'])window.localStorage.removeItem(key);
    window.sessionStorage.setItem(
      ACCESS_TOKEN_KEY,
      token,
    );
  },

  clear(): void {
    expectedUser = null;
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.removeItem('organization_operation');
    for(const key of ['access_token','refresh_token','user_email','portal_customer'])window.sessionStorage.removeItem(key);
    window.localStorage.removeItem('refresh_token');
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

export function endSession() {
  session.clear();
  if(typeof window!=='undefined')window.dispatchEvent(new Event('session-ended'));
}
