"use client";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import BackofficeShell from "@/app/components/BackofficeShell";
import AccountSettings from "@/app/components/AccountSettings";
export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <BackofficeShell>
        <AccountSettings />
      </BackofficeShell>
    </ProtectedRoute>
  );
}
