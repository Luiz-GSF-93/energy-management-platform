"use client";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/app/providers/AuthProvider";
import { accountApi, Account, Preferences } from "@/app/lib/account";
type Environment = {
  account: Account | null;
  error: string;
  reload: () => Promise<void>;
  save: (value: Preferences) => Promise<void>;
};
const EnvironmentContext = createContext<Environment | null>(null);
export function UserEnvironmentProvider({ children }: { children: ReactNode }) {
  const { status, context } = useAuth(),
    user = status === "authenticated" ? context?.user.id : null;
  const [loaded, setLoaded] = useState<{
      user: string;
      account: Account;
    } | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  const account = loaded && loaded.user === user ? loaded.account : null;
  const reload = useCallback(async () => {
    const id = ++generation.current;
    setError("");
    if (!user) {
      setLoaded(null);
      return;
    }
    try {
      const data = await accountApi.read();
      if (id === generation.current) setLoaded({ user, account: data });
    } catch {
      if (id === generation.current)
        setError("Não foi possível carregar suas configurações.");
    }
  }, [user]);
  useEffect(() => {
    const clock = generation;
    const timer = window.setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(timer);
      clock.current++;
    };
  }, [reload]);
  useEffect(() => {
    document.documentElement.dataset.energyosTheme =
      account?.preferences.theme || "blue";
    return () => {
      document.documentElement.dataset.energyosTheme = "blue";
    };
  }, [account?.preferences.theme]);
  const save = useCallback(
    async (value: Preferences) => {
      if (!user || !account)
        throw new Error("Atualize suas configurações antes de salvar.");
      const id = generation.current;
      const prefs = await accountApi.save(value);
      if (id === generation.current)
        setLoaded({ user, account: { ...account, preferences: prefs } });
    },
    [user, account],
  );
  return (
    <EnvironmentContext.Provider value={{ account, error, reload, save }}>
      {children}
    </EnvironmentContext.Provider>
  );
}
export function useUserEnvironment() {
  const value = useContext(EnvironmentContext);
  if (!value) throw new Error("UserEnvironmentProvider ausente");
  return value;
}
