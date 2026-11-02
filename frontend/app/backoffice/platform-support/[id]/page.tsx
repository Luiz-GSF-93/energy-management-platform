'use client';
import {useParams} from 'next/navigation';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import BackofficeShell from '@/app/components/BackofficeShell';
import CentralSupportThread from '@/app/components/CentralSupportThread';
export default function Page(){const {id}=useParams<{id:string}>();return <ProtectedRoute><BackofficeShell><CentralSupportThread key={id} id={id} platform={true}/></BackofficeShell></ProtectedRoute>;}
