"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import AuthenticatorSettings from "@/app/components/AuthenticatorSettings";
import AuthenticatedDestination from "@/app/components/AuthenticatedDestination";
export default function MfaPage() {
  const { status } = useAuth(),
    router = useRouter();
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/auth/login");
  }, [status, router]);
  if (status === 'authenticated') return <AuthenticatedDestination/>;
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
