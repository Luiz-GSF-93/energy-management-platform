"use client";
import Link from "next/link";
import { useUserEnvironment } from "@/app/providers/UserEnvironmentProvider";
import { initials } from "@/app/lib/account";
export function UserAvatar() {
  const { account } = useUserEnvironment(),
    p = account?.preferences;
  return (
    <span className="environment-avatar" aria-hidden="true">
      {p?.avatar_kind === "photo" && p.photo ? (
        <img src={p.photo} alt="" width={40} height={40} />
      ) : p?.avatar_kind === "emoji" ? (
        p.emoji
      ) : (
        initials(account?.identity.name)
      )}
    </span>
  );
}
export default function UserIdentity({ portal = false }: { portal?: boolean }) {
  const { account } = useUserEnvironment();
  return (
    <Link
      className="environment-user"
      href={portal ? "/portal/settings" : "/backoffice/settings"}
      aria-label="Abrir minhas configurações de ambiente"
    >
      <UserAvatar />
      <span>
        {account?.identity.name || "Nome não cadastrado"}
        <small>Meu ambiente</small>
      </span>
    </Link>
  );
}
export function UserWelcome() {
  const { account } = useUserEnvironment();
  return (
    <p className="environment-welcome">
      <span aria-hidden="true">👋</span>{" "}
      {account?.identity.name
        ? "Olá, " +
          account.identity.name.trim().split(/\s+/)[0] +
          "! Que bom te ver novamente!"
        : "Olá! Que bom te ver novamente!"}
    </p>
  );
}
