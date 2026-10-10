"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/app/providers";
import { apiRequest } from "@/app/lib/api/client";
import { session } from "@/app/lib/auth/session";
import { Alert, Button, Input } from "@/app/components/ui";
interface Factor {
  id: string;
  status: string;
}
interface Tokens {
  access_token: string;
  refresh_token: string;
}
export default function AuthenticatorSettings({
  challengeOnly = false,
}: {
  challengeOnly?: boolean;
}) {
  const { refresh, logout } = useAuth(),
    [factors, setFactors] = useState<Factor[] | null>(null),
    [qr, setQr] = useState(""),
    [pending, setPending] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const data = await apiRequest<{ factors: Factor[] }>(
      "/api/v1/auth/account/mfa",
    );
    setFactors(data.factors);
  }, []);
  useEffect(() => {
    let active = true;
    void apiRequest<{ factors: Factor[] }>("/api/v1/auth/account/mfa")
      .then((d) => {
        if (active) setFactors(d.factors);
      })
      .catch(() => {
        if (active) setError("Não foi possível consultar o autenticador.");
      });
    return () => {
      active = false;
    };
  }, []);
  const verified = factors?.find((f) => f.status === "verified"),
    draft = factors?.find((f) => f.status !== "verified"),
    factorId = pending || verified?.id || draft?.id;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operação indisponível.");
    } finally {
      setCode("");
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent, remove = false) {
    event.preventDefault();
    if (!factorId) return;
    await run(async () => {
      const challenge = await apiRequest<{ id: string }>(
        "/api/v1/auth/account/mfa/challenge",
        { method: "POST", body: { factor_id: factorId } },
      );
      const tokens = await apiRequest<Tokens>(
        "/api/v1/auth/account/mfa/verify",
        {
          method: "POST",
          body: { factor_id: factorId, challenge_id: challenge.id, code },
        },
      );
      session.setTokens(tokens);
      setQr("");
      setPending("");
      if (remove) {
        await apiRequest("/api/v1/auth/account/mfa/remove", {
          method: "POST",
          body: { factor_id: factorId },
        });
        setNotice("Autenticador desativado por você.");
      } else setNotice("Código confirmado. Autenticador ativo.");
      await load();
      await refresh(challengeOnly);
    });
  }
  return (
    <section className="ds-card environment-security">
      <h2>
        {challengeOnly
          ? "Confirme seu acesso"
          : "Segurança — aplicativo autenticador"}
      </h2>
      <p>
        Use Google Authenticator, Microsoft Authenticator ou outro aplicativo
        compatível. A ativação é opcional e exige a confirmação do código.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {factors === null ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run(load)}
        >
          Consultar autenticador
        </Button>
      ) : null}
      {!challengeOnly && factors !== null && !verified && !draft && !pending ? (
        <>
          <p>
            Autenticador desativado. Entre novamente com sua senha se o login
            ocorreu há mais de cinco minutos.
          </p>
          <div className="environment-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await apiRequest<{
                    id: string;
                    qr_code: string;
                  }>("/api/v1/auth/account/mfa/enroll", { method: "POST" });
                  if (!data.id || !data.qr_code)
                    throw new Error("QR Code indisponível. Atualize a tela.");
                  setPending(data.id);
                  setQr(
                    "data:image/svg+xml;charset=utf-8," +
                      encodeURIComponent(data.qr_code),
                  );
                  await load();
                })
              }
            >
              Ativar por QR Code
            </Button>
            <Link href="/auth/login" onClick={() => logout()}>
              Entrar novamente
            </Link>
          </div>
        </>
      ) : null}
      {qr ? (
        <div className="environment-qr">
          <img
            src={qr}
            alt="QR Code pessoal para configurar o autenticador"
            width={220}
            height={220}
          />
          <p>
            Escaneie no seu aplicativo e confirme o código abaixo. Não
            compartilhe este QR Code.
          </p>
        </div>
      ) : null}
      {!qr && draft && !challengeOnly ? (
        <p>
          Existe uma ativação não concluída. Use o código do aplicativo já
          configurado ou cancele e gere um novo QR Code.
        </p>
      ) : null}
      {verified && !challengeOnly ? (
        <p>
          <strong>Autenticador ativo.</strong> Confirme um código novo para
          desativar.
        </p>
      ) : null}
      {factorId ? (
        <form onSubmit={(e) => void confirm(e)}>
          <Input
            label="Código do aplicativo"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            pattern="[0-9]{6}"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
          <div className="environment-actions">
            <Button type="submit" disabled={busy || code.length !== 6}>
              {busy
                ? "Confirmando…"
                : challengeOnly
                  ? "Confirmar acesso"
                  : verified
                    ? "Confirmar código"
                    : "Confirmar ativação"}
            </Button>
            {verified && !challengeOnly ? (
              <Button
                variant="danger"
                disabled={busy || code.length !== 6}
                onClick={(e) => void confirm(e, true)}
              >
                Confirmar e desativar
              </Button>
            ) : null}
            {draft && !challengeOnly ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await apiRequest("/api/v1/auth/account/mfa/remove", {
                      method: "POST",
                      body: { factor_id: draft.id },
                    });
                    setQr("");
                    setPending("");
                    await load();
                  })
                }
              >
                Cancelar ativação
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      <p className="environment-help">
        Se perder o aplicativo, solicite recuperação assistida com verificação
        de identidade. Recuperar a senha não remove o autenticador.
      </p>
      {challengeOnly ? (
        <Button variant="secondary" onClick={logout}>
          Voltar ao login
        </Button>
      ) : null}
    </section>
  );
}
