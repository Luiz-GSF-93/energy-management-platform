 'use client';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {Alert} from '@/app/components/ui';
import {useAuth} from '@/app/providers';
import GuidePublications from './GuidePublications';
export default function Page(){const {context,hasPermission}=useAuth();return <ProtectedRoute><BackofficeShell>{context?.scope==='global'&&hasPermission('82e7fc71-479a-4dd6-8b22-4fba6eaa6841')?<GuidePublications key={context.user.id}/>:<Alert>Gestão exclusiva do Owner da plataforma.</Alert>}</BackofficeShell></ProtectedRoute>;}
