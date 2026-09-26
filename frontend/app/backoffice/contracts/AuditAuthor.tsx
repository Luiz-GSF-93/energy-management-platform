export type AuditAuthorFields = {created_by_name?:string|null;updated_by_name?:string|null;validated_by_name?:string|null};
export default function AuditAuthor({id,name}:{id:string|null;name?:string|null}) {
 return <span title={id ? 'Identificador de auditoria: '+id : undefined}>{name?.trim() || 'Nome não disponível'}</span>;
}
