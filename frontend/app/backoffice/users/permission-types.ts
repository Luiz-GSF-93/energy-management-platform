export type PermissionAvailability={assignable:boolean;configurable:boolean;reason?:string|null};
export type PermissionOption={id:string;code:string;name:string;module:string;action?:string;description?:string;dependencies?:string[];availability?:Record<string,PermissionAvailability>};
export type PermissionRole={id:string;name:string;permissions:string[];defaultPermissions?:string[];revision?:string;canConfigure?:boolean;canAssign?:boolean};
export type AccessCatalog={metadataVersion?:number;customers:{id:string;company_name:string}[];units:{id:string;customer_id:string;name:string;consumer_unit_number:string}[];canApprove:boolean;roles:PermissionRole[];permissions:PermissionOption[];members:{user_id:string;role_id:string;permission_limit:string[]|null;affiliation_type?:string}[]};
export const roleLabel:Record<string,string>={admin_org:'Administrador da organização',gestor:'Gestor',operacional:'Operador',consulta:'Consulta (leitura)'};
