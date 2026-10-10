import { apiRequest } from "./api/client";
export type Theme = "blue" | "light" | "graphite";
export interface Preferences {
  revision: number;
  theme: Theme;
  avatar_kind: "initials" | "emoji" | "photo";
  emoji: string;
  photo: string;
  cep: string;
  personal_phone: string;
}
export interface Account {
  identity: {
    name: string | null;
    email: string | null;
    memberships: Array<{
      affiliation_type: string | null;
      organizations: { name: string } | null;
      roles: { name: string } | null;
    }>;
  };
  preferences: Preferences;
}
export const accountApi = {
  read: () => apiRequest<Account>("/api/v1/auth/account/preferences"),
  save: (body: Preferences) =>
    apiRequest<Preferences>("/api/v1/auth/account/preferences", {
      method: "PATCH",
      body: {
        revision: body.revision,
        theme: body.theme,
        avatar_kind: body.avatar_kind,
        emoji: body.emoji,
        photo: body.photo,
        cep: body.cep,
        personal_phone: body.personal_phone,
      },
    }),
};
export function initials(name: string | null | undefined) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return parts.length
    ? (
        (parts[0][0] || "") +
        (parts.length > 1 ? parts[parts.length - 1][0] : "")
      ).toLocaleUpperCase("pt-BR")
    : "?";
}
export const themeLabels: Record<Theme, string> = {
  blue: "EnergyOS Azul",
  light: "Claro",
  graphite: "Grafite",
};
