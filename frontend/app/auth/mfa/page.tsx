"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import AuthenticatorSettings from "@/app/components/AuthenticatorSettings";
import { apiRequest } from "@/app/lib/api/client";
export default function MfaPage() {
  const { status, context } = useAuth(),
    router = useRouter();
  useEffect(() => {
    const abort = new AbortController();
    if (status === "unauthenticated") router.replace("/auth/login");
    else if (status === "authenticated") {
      if (
        context &&
        context.scope !== "global" &&
        context.currentOrganization.role === "consulta" &&
        !context.accessMode
      ) {
        const organization = context.currentOrganization.id;
        void apiRequest<{ organizationId: string; audience: string }>(
          "/api/v1/portal/access",
          { signal: abort.signal },
        )
          .then((data) => {
            if (
              !abort.signal.aborted &&
              data.organizationId === organization &&
              ["client", "backoffice"].includes(data.audience)
            )
              router.replace(
                data.audience === "client"
                  ? "/portal"
                  : "/backoffice/dashboard",
              );
          })
          .catch(() => {
            if (!abort.signal.aborted) router.replace("/auth/login");
          });
      } else router.replace("/backoffice/dashboard");
    }
    return () => abort.abort();
  }, [status, context, router]);
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>EnergyOS</h1>
        {status === "mfa_required" ? (
          <AuthenticatorSettings challengeOnly />
        ) : (
          <p>Validando acesso…</p>
        )}
      </div>
    </main>
  );
}
