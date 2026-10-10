'use client';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import CommunicationsWorkspace from './CommunicationsWorkspace';
import {Alert} from '@/app/components/ui';
import {useAuth} from '@/app/providers';
export default function Page(){const {context,hasPermission}=useAuth();const allowed=context?.scope==='global'&&(hasPermission('82e7fc71-479a-4dd6-8b22-4fba6eaa6841')||hasPermission('c51b6e94-969a-4b9b-bcf9-05c18a4cb2d7'));return <ProtectedRoute><BackofficeShell><section className="backoffice-page"><h1 className="backoffice-page__title">Comunicação da plataforma</h1>{allowed?<><p>Consulta técnica dos retornos e modelos de WhatsApp. Eventos de entrega não representam valores cobrados.</p><CommunicationsWorkspace key={context.user.id}/></>:<Alert>Acesso exclusivo à equipe autorizada da plataforma.</Alert>}</section></BackofficeShell></ProtectedRoute>;}
