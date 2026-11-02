'use client';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import AuditWorkspace from '@/app/components/AuditWorkspace';
export default function Page(){return <ProtectedRoute><BackofficeShell><AuditWorkspace /></BackofficeShell></ProtectedRoute>;}
