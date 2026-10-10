import { ForbiddenException, SetMetadata } from "@nestjs/common";
export const MFA_HANDSHAKE = "accountMfaHandshake";
// Only status/challenge/verify can bypass AAL2, never tenant or business endpoints.
export const MfaHandshake = () => SetMetadata(MFA_HANDSHAKE, true);
export interface MfaFactor {
  id: string;
  factor_type: string;
  status: string;
}
export function tokenAssurance(token: string): {
  aal?: string;
  amr?: Array<{ method: string; timestamp: number }>;
} {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}
export function assertMfa(
  factors: MfaFactor[],
  token: string,
  handshake = false,
): void {
  if (
    !handshake &&
    factors.some((f) => f.status === "verified") &&
    tokenAssurance(token).aal !== "aal2"
  ) {
    throw new ForbiddenException("MFA_REQUIRED");
  }
}
export function assertRecentMethod(
  token: string,
  method: string,
  now = Date.now(),
): void {
  const methods = tokenAssurance(token).amr || [];
  if (
    !methods.some(
      (m) =>
        m.method === method &&
        Number.isFinite(m.timestamp) &&
        m.timestamp <= now / 1000 + 30 &&
        now / 1000 - m.timestamp <= 300,
    )
  ) {
    throw new ForbiddenException(
      method === "password"
        ? "Entre novamente com sua senha antes de ativar o autenticador."
        : "Confirme um novo código do autenticador antes de desativá-lo.",
    );
  }
}
