'use client';
import {ReactNode} from 'react';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import BackofficeShell from '@/app/components/BackofficeShell';
export default function ReportsLayout({children}:{children:ReactNode}){return <ProtectedRoute><BackofficeShell>{children}</BackofficeShell></ProtectedRoute>;}
