import { session, tokenClaims } from "@/app/lib/auth/session";

/** UI race protection only; the backend/provider validate the actual credentials. */
export function assertSameMfaSession(
  before: string | null,
  after?: string,
): void {
  const current = session.getAccessToken();
  const subject = tokenClaims(before).sub;
  if (
    !before ||
    !subject ||
    current !== before ||
    (after && tokenClaims(after).sub !== subject)
  ) {
    throw new Error("Sua sessão mudou. Reabra a confirmação do autenticador.");
  }
}
