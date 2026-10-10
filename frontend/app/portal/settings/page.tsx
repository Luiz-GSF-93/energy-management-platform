"use client";
import Link from "next/link";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import AccountSettings from "@/app/components/AccountSettings";
import UserIdentity from "@/app/components/UserIdentity";
import portalStyles from "../portal.module.css";
export default function PortalSettingsPage() {
  return (
    <ProtectedRoute>
      <div className={portalStyles.layout}>
        <nav className={portalStyles.sidebar} aria-label="Menu do Portal">
          <strong>EnergyOS</strong>
          <Link href="/portal">Dashboard</Link>
          <Link href="/portal/settings" aria-current="page">
            ⚙ Configurações ambiente
          </Link>
        </nav>
        <main className="client-portal">
          <div className="environment-topbar">
            <UserIdentity portal />
          </div>
          <AccountSettings />
        </main>
      </div>
    </ProtectedRoute>
  );
}
