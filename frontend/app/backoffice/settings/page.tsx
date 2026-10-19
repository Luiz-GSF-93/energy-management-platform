"use client";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import BackofficeShell from "@/app/components/BackofficeShell";
import AccountSettings from "@/app/components/AccountSettings";
import OrganizationBrandingEditor from "@/app/components/OrganizationBrandingEditor";
export default function SettingsPage() {
  return (
    <ProtectedRoute>
      <BackofficeShell>
        <AccountSettings />
        <OrganizationBrandingEditor />
      </BackofficeShell>
    </ProtectedRoute>
  );
}
