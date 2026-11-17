'use client';
import BackofficeShell from '@/app/components/BackofficeShell';
import ProtectedRoute from '@/app/components/ProtectedRoute';
import {useAuth} from '@/app/providers';
import LegalAuditWorkspace from './LegalAuditWorkspace';
function AuditWorkspace(){
 const {context,hasPermission}=useAuth();
 if(context?.scope!=='organization'||!hasPermission('8f105b02-4443-49de-b188-847e0284e7ed'))return <p role="alert">Selecione uma organização com acesso a documentos para consultar a auditoria contratual.</p>;
 return <section className="operation-panel"><LegalAuditWorkspace/></section>;
}
export default function OcrAuditPage(){const {context}=useAuth();const scope=context?.scope==='global'?'global':context?.currentOrganization.id??'none';return <ProtectedRoute><BackofficeShell><AuditWorkspace key={scope}/></BackofficeShell></ProtectedRoute>;}
