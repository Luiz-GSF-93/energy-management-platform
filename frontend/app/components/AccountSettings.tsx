"use client";
import { FormEvent, useEffect, useState } from "react";
import { useUserEnvironment } from "@/app/providers/UserEnvironmentProvider";
import { Preferences, themeLabels, Theme } from "@/app/lib/account";
import { UserAvatar } from "./UserIdentity";
import AuthenticatorSettings from "./AuthenticatorSettings";
import { Alert, Button, Input } from "./ui";
import { apiRequest } from "@/app/lib/api/client";
const roles: Record<string, string> = {
  admin_org: "Administrador da organização",
  gestor: "Gestor",
  operacional: "Operador",
  consulta: "Consulta",
  admin_platform: "Administrador da plataforma",
};
async function thumbnail(file: File): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Selecione uma foto PNG, JPEG ou WebP de até 5 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.width * image.height > 40000000)
      throw new Error("A imagem é muito grande.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Foto indisponível neste navegador.");
    const side = Math.min(image.width, image.height);
    ctx.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      128,
      128,
    );
    const data = canvas.toDataURL("image/png");
    if (data.length > 80000) throw new Error("Reduza o tamanho da foto.");
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export default function AccountSettings() {
  const { account, error, reload, save } = useUserEnvironment(),
    [draft, setDraft] = useState<Preferences | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [failure, setFailure] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDraft(account?.preferences || null),
      0,
    );
    return () => clearTimeout(timer);
  }, [account]);
  function change<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setDraft((p) => (p ? { ...p, [key]: value } : p));
    setMessage("");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setFailure("");
    try {
      await save(draft);
      setMessage("Configurações salvas.");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="backoffice-page environment-page">
      <header className="backoffice-page__header">
        <h1>Configurações ambiente</h1>
        <p>
          Seu espaço no EnergyOS. Personalize a aparência e cuide do seu acesso.
        </p>
      </header>
      {error ? (
        <Alert>
          {error}
          <Button variant="secondary" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </Alert>
      ) : null}
      {failure ? <Alert>{failure}</Alert> : null}
      {message ? <p role="status">{message}</p> : null}
      {!account || !draft ? (
        <p>Carregando suas configurações…</p>
      ) : (
        <>
          <section className="ds-card">
            <h2>Seu cadastro</h2>
            <div className="environment-grid">
              <Input
                label="Nome completo"
                value={account.identity.name || "Nome não cadastrado"}
                readOnly
              />
              <Input
                label="E-mail de acesso"
                value={account.identity.email || "E-mail não cadastrado"}
                readOnly
              />
            </div>
            <p className="environment-help">
              Nome, e-mail, função e vínculos são definidos pela administração.
              Solicite correção ao administrador ou gestor.
            </p>
            {account.identity.memberships.map((m, i) => (
              <div className="environment-membership" key={i}>
                <strong>
                  {m.organizations?.name || "Organização não identificada"}
                </strong>
                <span>
                  Função:{" "}
                  {roles[m.roles?.name || ""] ||
                    m.roles?.name ||
                    "Não informada"}
                </span>
                <span>
                  Vínculo:{" "}
                  {m.affiliation_type === "internal"
                    ? "Interno"
                    : m.affiliation_type === "external"
                      ? "Externo"
                      : "Não definido"}
                </span>
              </div>
            ))}
          </section>
          <form onSubmit={(e) => void submit(e)}>
            <section className="ds-card">
              <h2>Aparência</h2>
              <fieldset className="environment-options">
                <legend>Tema das telas</legend>
                {(Object.keys(themeLabels) as Theme[]).map((t) => (
                  <label
                    className={"environment-theme environment-theme--" + t}
                    key={t}
                  >
                    <span className="environment-palette" />
                    <span>
                      <input
                        type="radio"
                        name="theme"
                        value={t}
                        checked={draft.theme === t}
                        onChange={() => change("theme", t)}
                      />
                      {themeLabels[t]}
                    </span>
                  </label>
                ))}
              </fieldset>
              <h3>Como você aparece</h3>
              <div className="environment-grid">
                <div>
                  <div className="environment-avatar-preview">
                    <UserAvatar />
                    <span>
                      {account.identity.name || "Nome não cadastrado"}
                    </span>
                  </div>
                  <label className="ds-label" htmlFor="avatar-kind">
                    Avatar
                  </label>
                  <select
                    id="avatar-kind"
                    className="ds-input"
                    value={draft.avatar_kind}
                    onChange={(e) =>
                      change(
                        "avatar_kind",
                        e.target.value as Preferences["avatar_kind"],
                      )
                    }
                  >
                    <option value="initials">
                      Iniciais do nome e sobrenome
                    </option>
                    <option value="emoji">Emoji</option>
                    <option value="photo">Foto</option>
                  </select>
                </div>
                <div>
                  {draft.avatar_kind === "emoji" ? (
                    <fieldset className="environment-options">
                      <legend>Escolha seu emoji</legend>
                      {["🙂", "😎", "🌿", "⚡"].map((emoji) => (
                        <label key={emoji}>
                          <input
                            type="radio"
                            name="emoji"
                            checked={draft.emoji === emoji}
                            onChange={() => change("emoji", emoji)}
                          />
                          <span className="environment-emoji">{emoji}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}
                  {draft.avatar_kind === "photo" ? (
                    <>
                      <Input
                        label="Selecionar foto"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            void thumbnail(f)
                              .then((p) => change("photo", p))
                              .catch((e) => setFailure(e.message));
                        }}
                      />
                      {draft.photo ? (
                        <img
                          className="environment-photo-preview"
                          src={draft.photo}
                          alt="Prévia da sua foto"
                          width={72}
                          height={72}
                        />
                      ) : null}
                      <p className="environment-help">
                        Foto privada da sua conta. A imagem será recortada em
                        quadrado e os metadados serão removidos.
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
            </section>
            <section className="ds-card">
              <h2>Contatos pessoais</h2>
              <p>
                Estes dados não alteram o cadastro administrativo nem os
                destinatários de notificações da organização.
              </p>
              <div className="environment-grid">
                <Input
                  label="CEP pessoal"
                  value={draft.cep}
                  maxLength={8}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  onChange={(e) =>
                    change("cep", e.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                />
                <Input
                  label="Telefone pessoal"
                  type="tel"
                  value={draft.personal_phone}
                  maxLength={25}
                  autoComplete="tel"
                  onChange={(e) => change("personal_phone", e.target.value)}
                />
              </div>
              <div className="environment-actions">
                <Button type="submit" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar configurações"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setDraft(account.preferences);
                    setFailure("");
                  }}
                >
                  Descartar alterações
                </Button>
              </div>
            </section>
          </form>
          <section className="ds-card">
            <h2>Senha de acesso</h2>
            <p>
              A alteração usa o fluxo seguro do EnergyOS com link enviado ao seu
              e-mail de acesso.
            </p>
            <Button
              variant="secondary"
              disabled={busy || !account.identity.email}
              onClick={() => {
                setBusy(true);
                setFailure("");
                void apiRequest("/api/v1/auth/forgot-password", {
                  method: "POST",
                  authenticated: false,
                  body: { email: account.identity.email },
                })
                  .then(() =>
                    setMessage(
                      "Solicitação enviada. Confira seu e-mail para seguir o fluxo de alteração de senha.",
                    ),
                  )
                  .catch(() =>
                    setFailure(
                      "Não foi possível solicitar a alteração. Tente novamente.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Receber link para alterar senha
            </Button>
          </section>
          <AuthenticatorSettings />
        </>
      )}
    </section>
  );
}
