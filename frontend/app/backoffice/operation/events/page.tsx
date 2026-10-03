'use client';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import BackofficeShell from '@/app/components/BackofficeShell';
import OperationsWorkspace from '@/app/components/OperationsWorkspace';
export default function Page(){return <ProtectedRoute><BackofficeShell><OperationsWorkspace area="events"/></BackofficeShell></ProtectedRoute>;}
